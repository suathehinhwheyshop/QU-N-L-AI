import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdtemp,
  stat,
  rename,
  copyFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
const root = process.env.ORBIT_BACKUP_DIR ?? "/backups",
  storage = process.env.ORBIT_STORAGE_DIR ?? "/data/artifacts";
const key = Buffer.from(
  (
    await readFile(
      process.env.ORBIT_BACKUP_KEY_FILE ?? "/run/secrets/backup_key",
      "utf8",
    )
  ).trim(),
  "base64",
);
if (key.length !== 32) throw Error("BACKUP_KEY_REQUIRED");
const pgEnv = {
  ...process.env,
  PGHOST: process.env.ORBIT_DATABASE_HOST ?? "db",
  PGDATABASE: process.env.ORBIT_DATABASE_NAME ?? "orbit",
  PGUSER: process.env.ORBIT_DATABASE_USER ?? "orbit_migrator",
  PGPASSWORD: (
    await readFile(
      process.env.ORBIT_DATABASE_PASSWORD_FILE ?? "/run/secrets/db_password",
      "utf8",
    )
  ).trim(),
};
const sql = (text, database = pgEnv.PGDATABASE) =>
  execFileSync(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", text],
    { env: pgEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
async function run(program, args, options = {}) {
  const child = spawn(program, args, {
    env: pgEnv,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let error = "";
  child.stderr?.on("data", (b) => {
    if (error.length < 2000) error += b;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (c) =>
      c === 0 ? resolve() : reject(Error("BACKUP_SUBPROCESS_FAILED")),
    );
  });
  return { child, done };
}
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const b of createReadStream(path)) hash.update(b);
  return hash.digest("hex");
}
async function backup() {
  await mkdir(root, { recursive: true, mode: 0o700 });

  let tmp, dir;
  try {
    const id =
      new Date().toISOString().replaceAll(/[-:.]/g, "") +
      "-" +
      randomBytes(4).toString("hex");
    tmp = await mkdtemp("/tmp/orbit-backup-");
    dir = join(root, ".pending-" + id);
    await mkdir(dir, { mode: 0o700 });
    // DB snapshot first: published content-addressed blobs precede DB references and are immutable.
    const dump = await run("pg_dump", [
      "-Fc",
      "--no-owner",
      "--no-acl",
      "--file",
      tmp + "/database.dump",
    ]);
    await dump.done;
    const tar = await run("tar", [
      "-cf",
      "-",
      "-C",
      tmp,
      "database.dump",
      "-C",
      storage,
      "--exclude=.pending-*",
      ".",
    ]);
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("orbit-backup:" + id));
    await Promise.all([
      pipeline(
        tar.child.stdout,
        cipher,
        createWriteStream(dir + "/archive.enc", { mode: 0o600, flags: "wx" }),
      ),
      tar.done,
    ]);
    const manifest = {
      version: 1,
      id,
      at: new Date().toISOString(),
      sha256: await checksum(dir + "/archive.enc"),
      bytes: (await stat(dir + "/archive.enc")).size,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      key_id: createHash("sha256").update(key).digest("hex").slice(0, 16),
      database: pgEnv.PGDATABASE,
    };
    await writeFile(
      dir + "/manifest.json",
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(dir, join(root, id));
    dir = undefined;
    await writeFile(
      root + "/last-success.json",
      JSON.stringify(manifest) + "\n",
      { mode: 0o600 },
    );
    const keep = Number(process.env.ORBIT_BACKUP_KEEP ?? 7);
    if (!Number.isInteger(keep) || keep < 2 || keep > 365)
      throw Error("INVALID_RETENTION");
    const old = (await readdir(root))
      .filter((n) => /^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(n))
      .sort()
      .reverse()
      .slice(keep);
    for (const n of old) await rm(join(root, n), { recursive: true });
    console.log(
      JSON.stringify({ event: "backup_complete", id, bytes: manifest.bytes }),
    );
    return manifest;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
async function lockedBackup() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const p = await run("flock", [
    "--nonblock",
    join(root, ".backup.lock"),
    process.execPath,
    new URL(import.meta.url).pathname,
    "_locked",
  ]);
  p.child.stdout.pipe(process.stdout);
  await p.done;
}
let restoreStage = "INIT";
async function restore(id, target) {
  if (
    !/^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(id ?? "") ||
    !/^orbit_restore_[a-z0-9_]{1,48}$/.test(target ?? "")
  )
    throw Error("FRESH_RESTORE_TARGET_REQUIRED");
  if (sql(`SELECT 1 FROM pg_database WHERE datname='${target}'`))
    throw Error("RESTORE_TARGET_EXISTS");
  const out = process.env.ORBIT_RESTORE_DIR ?? "/restore-artifacts";
  await mkdir(out, { recursive: true, mode: 0o700 });
  if ((await readdir(out)).length)
    throw Error("RESTORE_ARTIFACT_DIR_NOT_EMPTY");
  const dir = join(root, id),
    manifest = JSON.parse(await readFile(dir + "/manifest.json", "utf8"));
  if (
    manifest.version !== 1 ||
    manifest.id !== id ||
    (await checksum(dir + "/archive.enc")) !== manifest.sha256
  )
    throw Error("BACKUP_CHECKSUM_MISMATCH");
  const tmp = await mkdtemp("/tmp/orbit-restore-");
  restoreStage = "AUTHENTICATE";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(manifest.iv, "base64"),
    );
    decipher.setAAD(Buffer.from("orbit-backup:" + id));
    decipher.setAuthTag(Buffer.from(manifest.tag, "base64"));
    // Authenticate completely BEFORE extraction or database creation.
    await pipeline(
      createReadStream(dir + "/archive.enc"),
      decipher,
      createWriteStream(tmp + "/verified.tar", { mode: 0o600 }),
    );
    restoreStage = "TAR_LIST";
    const names = execFileSync("tar", ["-tf", tmp + "/verified.tar"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    if (
      !names.includes("database.dump") ||
      names.some(
        (n) =>
          n !== "database.dump" && n !== "./" && !/^\.\/[a-f0-9]{64}$/.test(n),
      )
    )
      throw Error("UNSAFE_BACKUP_PATH");
    restoreStage = "TAR_EXTRACT";
    execFileSync(
      "tar",
      ["-xf", tmp + "/verified.tar", "--no-same-owner", "-C", tmp],
      { stdio: "pipe" },
    );
    for (const n of names.filter((n) => /^\.\/[a-f0-9]{64}$/.test(n))) {
      if ((await checksum(join(tmp, n))) !== n.slice(2))
        throw Error("ARTIFACT_CORRUPT");
    }
    restoreStage = "CREATE_DATABASE";
    sql(`CREATE DATABASE "${target}"`);
    restoreStage = "PG_RESTORE";
    const restore = await run("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "-d",
      target,
      tmp + "/database.dump",
    ]);
    await restore.done;
    restoreStage = "REVOKE_SESSIONS";
    sql(
      "TRUNCATE auth_sessions,gsc_oauth_states,worker_heartbeats; UPDATE runs SET status='PAUSED' WHERE status IN ('RUNNING','QUEUED'); UPDATE provider_probes SET status='FAILED' WHERE status='RUNNING';",
      target,
    );
    restoreStage = "COPY_ARTIFACTS";
    let files = 0;
    for (const n of names.filter((n) => /^\.\/[a-f0-9]{64}$/.test(n))) {
      await copyFile(join(tmp, n), join(out, n.slice(2)), 1);
      if ((await checksum(join(out, n.slice(2)))) !== n.slice(2))
        throw Error("ARTIFACT_CORRUPT");
      files++;
    }
    console.log(
      JSON.stringify({
        event: "restore_complete",
        id,
        target,
        artifact_files: files,
        session_count: Number(
          sql("SELECT count(*) FROM auth_sessions", target),
        ),
        run_count: Number(sql("SELECT count(*) FROM runs", target)),
      }),
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
const mode = process.argv[2] ?? "daemon";
try {
  if (mode === "_locked") await backup();
  else if (mode === "once") await lockedBackup();
  else if (mode === "restore") await restore(process.argv[3], process.argv[4]);
  else if (mode === "health") {
    const m = JSON.parse(await readFile(root + "/last-success.json", "utf8"));
    if (Date.now() - Date.parse(m.at) > 26 * 3600_000)
      throw Error("BACKUP_STALE");
  } else if (mode === "daemon") {
    let stopping = false;
    let wake;
    const stop = () => {
      stopping = true;
      wake?.();
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    while (!stopping) {
      let delay = 24 * 3600_000;
      try {
        await lockedBackup();
      } catch {
        console.error(JSON.stringify({ event: "backup_failed" }));
        delay = 300_000;
      }
      if (!stopping)
        await new Promise((r) => {
          const t = setTimeout(r, delay);
          wake = () => {
            clearTimeout(t);
            r();
          };
        });
    }
  } else throw Error("UNKNOWN_BACKUP_COMMAND");
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : error && typeof error.code === "string" && /^[A-Z_]+$/.test(error.code)
        ? error.code
        : "BACKUP_OPERATION_FAILED";
  console.error(
    JSON.stringify({
      event: "backup_operation_failed",
      mode,
      code,
      stage: restoreStage,
    }),
  );
  process.exitCode = 1;
}

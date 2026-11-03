import { spawn, execFileSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  access,
  open,
  rm,
  readdir,
  rename,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  dir = resolve(process.env.ORBIT_LOCAL_DIR ?? join(root, ".orbit/personal"));
const action = process.argv[2],
  option = (n) => {
    const inline = process.argv.find((x) => x.startsWith("--" + n + "="));
    if (inline) return inline.slice(n.length + 3);
    const index = process.argv.indexOf("--" + n);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
async function writeAtomic(path, text) {
  const temporary = path + ".tmp-" + randomBytes(6).toString("hex");
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
const save = (path, value) =>
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
async function run(program, args, env = process.env, stdio = "inherit") {
  const c = spawn(program, args, { cwd: root, env, stdio });
  const code = await new Promise((r, j) => {
    c.once("error", j);
    c.once("exit", r);
  });
  if (code !== 0) throw Error("COMMAND_FAILED: " + program);
}
async function compose(extra, cfg, variables = {}) {
  return run(
    "docker",
    [
      "compose",
      "--env-file",
      dir + "/compose.env",
      "-f",
      root + "/compose.local.yml",
      "-p",
      cfg.project,
      ...extra,
    ],
    { ...process.env, ...variables },
  );
}
async function config() {
  const c = await read(dir + "/config.json");
  if (
    !/^orbit-personal-[a-f0-9]{8}$/.test(c.project) ||
    !/^orbit(?:_restore_[a-z0-9_]+)?$/.test(c.database) ||
    !/^\d+$/.test(String(c.port)) ||
    !/^\d+$/.test(String(c.dbPort))
  )
    throw Error("LOCAL_CONFIG_INVALID");
  return c;
}
async function env(c, role = "orbit_app") {
  const password = (
    await readFile(
      dir +
        "/secrets/" +
        (role === "orbit_migrator"
          ? "db_password"
          : role === "orbit_worker"
            ? "worker_db_password"
            : "api_db_password"),
      "utf8",
    )
  ).trim();
  const uri = new URL("postgresql://127.0.0.1:" + c.dbPort + "/" + c.database);
  uri.username = role;
  uri.password = password;
  return {
    ...process.env,
    DATABASE_URL: uri.href,
    ORBIT_DATABASE_NAME: c.database,
    ORBIT_ENV: "local",
    ORBIT_LOCAL_MODE: "true",
    ORBIT_OWNER_ID: c.owner ?? "provisioning",
    ORBIT_AI_POLICY: "subscription-only",
    ORBIT_SUBSCRIPTIONS_ENABLED: "true",
    ORBIT_CLI_DIR: dir + "/cli",
    ORBIT_BASE_URL: "http://127.0.0.1:" + c.port,
    ORBIT_COOKIE_SECURE: "false",
    ORBIT_STORAGE_DIR: c.artifacts,
    ORBIT_SESSION_SECRET_FILE: dir + "/secrets/session_secret",
    ORBIT_TOKEN_ENCRYPTION_KEY_FILE: dir + "/secrets/token_key",
    ORBIT_DB_SECRETS_DIR: dir + "/secrets",
  };
}
async function composeEnv(c) {
  await writeAtomic(
    dir + "/compose.env",
    `ORBIT_LOCAL_DIR=${dir}\nORBIT_LOCAL_UID=${process.getuid()}\nORBIT_LOCAL_GID=${process.getgid()}\nORBIT_LOCAL_DB_PORT=${c.dbPort}\nORBIT_DATABASE_NAME=${c.database}\nORBIT_ARTIFACT_DIR=${c.artifacts}\nORBIT_RESTORE_ARTIFACT_DIR=${dir}/restore-artifacts\n`,
  );
}
async function running() {
  try {
    const r = await read(dir + "/process.json"),
      args = await readFile("/proc/" + r.pid + "/cmdline", "utf8"),
      st = (await readFile("/proc/" + r.pid + "/stat", "utf8")).split(" ")[21];
    return args.includes(root + "/ops/local.mjs") &&
      args.includes("serve") &&
      st === r.start
      ? r
      : null;
  } catch {
    return null;
  }
}
async function ready(c) {
  const r = await fetch("http://127.0.0.1:" + c.port + "/api/health/ready");
  return r.ok;
}
async function stop(c) {
  const r = await running();
  if (r) {
    process.kill(-r.pid, "SIGTERM");
    const deadline = Date.now() + 155000;
    while (await running()) {
      if (Date.now() > deadline) throw Error("SHUTDOWN_TIMEOUT");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  await compose(["stop", "backup", "db"], c);
}
async function start(c) {
  await composeEnv(c);
  if (await running())
    return console.log("ORBIT is already running at 127.0.0.1:" + c.port);
  await compose(["up", "-d", "--wait", "db"], c);
  const output = await open(dir + "/server.log", "a", 0o600);
  const child = spawn(process.execPath, [root + "/ops/local.mjs", "serve"], {
    cwd: root,
    env: { ...process.env, ORBIT_LOCAL_DIR: dir },
    detached: true,
    stdio: ["ignore", output.fd, output.fd],
  });
  child.unref();
  await output.close();
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    try {
      if (await ready(c)) {
        await compose(["up", "-d", "backup"], c);
        return console.log(
          "ORBIT ready on http://127.0.0.1:" +
            c.port +
            "; existing workflows require Resume.",
        );
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("STARTUP_NOT_READY: inspect private server.log");
}
try {
  if (action === "install") {
    if (process.platform !== "linux") throw Error("WSL_LINUX_REQUIRED");
    execFileSync("docker", ["info", "--format", "{{.OSType}}"], {
      stdio: "pipe",
    });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let c;
    try {
      c = await config();
    } catch (e) {
      try {
        await access(dir + "/config.json");
        throw Error("EXISTING_CONFIG_INVALID");
      } catch (x) {
        if (x.message === "EXISTING_CONFIG_INVALID") throw x;
      }
      for (const p of [
        "secrets",
        "artifacts",
        "backups",
        "restore-artifacts",
        "cli",
      ])
        await mkdir(dir + "/" + p, { recursive: true, mode: 0o700 });
      for (const p of [
        "db_password",
        "api_db_password",
        "worker_db_password",
        "session_secret",
        "token_key",
        "backup_key",
      ])
        await writeFile(
          dir + "/secrets/" + p,
          randomBytes(32).toString("base64") + "\n",
          { mode: 0o600, flag: "wx" },
        );
      c = {
        project: "orbit-personal-" + randomBytes(4).toString("hex"),
        database: "orbit",
        port: 3210,
        dbPort: 55434,
        artifacts: dir + "/artifacts",
      };
      await save(dir + "/config.json", c);
    }
    await composeEnv(c);
    await run("npm", ["ci"]);
    await compose(["up", "-d", "--wait", "db"], c);
    const admin = await env(c, "orbit_migrator");
    await run(
      process.execPath,
      ["--import", "tsx", "scripts/migrate.ts"],
      admin,
    );
    await run(process.execPath, ["--import", "tsx", "ops/db-grants.ts"], admin);
    if (!c.owner) {
      const email = option("email");
      if (!email) throw Error("EXPLICIT_OWNER_EMAIL_REQUIRED");
      // Read password only from terminal or a private input file; never command arguments.
      if (process.stdin.isTTY) {
        await run(
          "bash",
          [root + "/ops/windows/provision-owner.sh", email],
          admin,
        );
      } else {
        const file = process.env.ORBIT_INSTALL_PASSWORD_FILE;
        if (!file) throw Error("INTERACTIVE_PASSWORD_REQUIRED");
        await run(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/provision-user.ts",
            "--email=" + email,
            "--password-file=" + file,
          ],
          admin,
        );
      }
      const found = execFileSync(
        process.execPath,
        ["--import", "tsx", "ops/local-owner.ts"],
        { cwd: root, env: admin, encoding: "utf8" },
      ).trim();
      c.owner = found;
      await save(dir + "/config.json", c);
    }
    await run("npm", ["run", "build"], await env(c));
    await run("docker", [
      "build",
      "-f",
      "Dockerfile.ops",
      "-t",
      "orbit-ops:local-subscription",
      ".",
    ]);
    console.log(
      "Installed. Run start explicitly. AI login and connection checks are separate.",
    );
  } else if (action === "serve") {
    const c = await config(),
      st = (await readFile("/proc/" + process.pid + "/stat", "utf8")).split(
        " ",
      )[21];
    if (await running()) throw Error("ALREADY_RUNNING");
    await save(dir + "/process.json", { pid: process.pid, start: st });
    const web = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(c.port),
      ],
      { cwd: root, env: await env(c), stdio: "inherit" },
    );
    const worker = spawn(
      process.execPath,
      ["--import", "tsx", "src/worker.ts"],
      { cwd: root, env: await env(c, "orbit_worker"), stdio: "inherit" },
    );
    let stopping = false;
    const done = (p) =>
      new Promise((r) => {
        if (p.exitCode !== null) return r();
        p.once("exit", r);
      });
    const drain = async () => {
      if (stopping) return;
      stopping = true;
      web.kill("SIGTERM");
      worker.kill("SIGTERM");
      await Promise.all([done(web), done(worker)]);
      await rm(dir + "/process.json", { force: true });
    };
    for (const sig of ["SIGTERM", "SIGINT"])
      process.on(sig, () => void drain());
    for (const p of [web, worker]) {
      p.on("error", () => void drain());
      p.on("exit", () => void drain());
    }
    await Promise.all([done(web), done(worker)]);
  } else {
    const c = await config();
    if (action === "start") await start(c);
    else if (action === "stop") await stop(c);
    else if (action === "restart") {
      await stop(c);
      await start(c);
    } else if (action === "status")
      console.log(
        JSON.stringify({
          running: !!(await running()),
          origin: "http://127.0.0.1:" + c.port,
          auto_resume: false,
        }),
      );
    else if (action === "backup") {
      await composeEnv(c);
      await compose(["up", "-d", "--wait", "db"], c);
      await compose(["run", "--rm", "--no-deps", "backup", "once"], c);
    } else if (action === "restore") {
      if (await running()) throw Error("STOP_ORBIT_BEFORE_RESTORE");
      await composeEnv(c);
      const id = option("backup");
      if (!/^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(id ?? ""))
        throw Error("BACKUP_ID_REQUIRED");

      await compose(["up", "-d", "--wait", "db"], c);
      const target = "orbit_restore_" + randomBytes(8).toString("hex");
      const restoredArtifacts = join(dir, "restores", target);
      await mkdir(restoredArtifacts, { recursive: true, mode: 0o700 });
      await compose(["run", "--rm", "restore", "restore", id, target], c, {
        ORBIT_RESTORE_ARTIFACT_DIR: restoredArtifacts,
      });
      await save(dir + "/previous-config.json", c);
      c.database = target;
      c.artifacts = restoredArtifacts;
      await save(dir + "/config.json", c);
      await composeEnv(c);
      await run(
        process.execPath,
        ["--import", "tsx", "ops/db-grants.ts"],
        await env(c, "orbit_migrator"),
      );
      console.log(
        "Restore selected; source DB preserved. Start and Resume manually.",
      );
    } else if (action === "update") {
      execFileSync("git", ["diff", "--quiet"], { cwd: root });
      execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: root });
      await compose(["up", "-d", "--wait", "db"], c);
      await compose(["run", "--rm", "--no-deps", "backup", "once"], c);
      await stop(c);
      await run("git", ["pull", "--ff-only"]);
      await run("npm", ["ci"]);
      await compose(["up", "-d", "--wait", "db"], c);
      await run(
        process.execPath,
        ["--import", "tsx", "scripts/migrate.ts"],
        await env(c, "orbit_migrator"),
      );
      await run(
        process.execPath,
        ["--import", "tsx", "ops/db-grants.ts"],
        await env(c, "orbit_migrator"),
      );
      await run("npm", ["run", "build"], await env(c));
      await run("docker", [
        "build",
        "-f",
        "Dockerfile.ops",
        "-t",
        "orbit-ops:local-subscription",
        ".",
      ]);
      console.log(
        "Updated; run start explicitly. Workflows will remain paused.",
      );
    } else if (["login-codex", "login-gemini", "install-cli"].includes(action))
      await run(
        process.execPath,
        ["--import", "tsx", "ops/subscription-login.ts", action],
        await env(c),
      );
    else throw Error("UNKNOWN_LOCAL_ACTION");
  }
} catch (e) {
  console.error(
    e instanceof Error && /^[A-Z0-9_ :.-]+$/.test(e.message)
      ? e.message
      : "LOCAL_OPERATION_FAILED; inspect prerequisites and private logs.",
  );
  process.exitCode = 1;
}

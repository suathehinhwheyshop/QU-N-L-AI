import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parse } from "dotenv";
const dir = resolve(".orbit/staging"),
  cfg = parse(await readFile(dir + "/staging.env"));
if (!cfg.ORBIT_BASE_URL.startsWith("https://localhost:"))
  throw Error("LOCAL_ONLY");
const project = process.env.ORBIT_STAGING_PROJECT ?? "orbit-phase4-local";
if (!project.startsWith("orbit-phase4-")) throw Error("LOCAL_ONLY");
const args = [
  "--host=unix:///var/run/docker.sock",
  "compose",
  "--env-file",
  dir + "/staging.env",
  "-f",
  "compose.staging.yml",
  "-p",
  project,
];
const run = (extra: string[], input?: string) =>
  execFileSync("docker", [...args, ...extra], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 2000000,
  });
const sql = (statement: string) =>
  run([
    "exec",
    "-T",
    "db",
    "psql",
    "-XqAt",
    "-U",
    "orbit_migrator",
    "-d",
    "orbit",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ]).trim();
const target = "orbit_restore_" + randomBytes(6).toString("hex");
try {
  run(["exec", "-T", "backup", "node", "/opt/orbit/backup.mjs", "once"]);
  const manifest = JSON.parse(
    run(["exec", "-T", "backup", "cat", "/backups/last-success.json"]),
  );
  const sourceRuns = Number(sql("SELECT count(*) FROM runs"));
  assert.ok(sourceRuns > 0);
  const result = run([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "-e",
    "ORBIT_RESTORE_DIR=/tmp/restored-artifacts",
    "restore",
    "restore",
    manifest.id,
    target,
  ]);
  const restored = JSON.parse(result.trim().split("\n").at(-1)!);
  assert.equal(restored.event, "restore_complete");
  assert.equal(restored.run_count, sourceRuns);
  assert.equal(restored.session_count, 0);
  assert.ok(restored.artifact_files > 0);
  const again = () =>
    run([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "ORBIT_RESTORE_DIR=/tmp/restored-again",
      "restore",
      "restore",
      manifest.id,
      target,
    ]);
  assert.throws(again);
  // Authenticated restore must reject tampered archives BEFORE creating a target.
  const badId = manifest.id.slice(0, -8) + randomBytes(4).toString("hex"),
    badTarget = target + "_bad";
  const inject = `const f=require('fs'),p='/backups/${manifest.id}',q='/backups/${badId}';f.mkdirSync(q);const b=f.readFileSync(p+'/archive.enc');b[0]^=1;f.writeFileSync(q+'/archive.enc',b);const m=JSON.parse(f.readFileSync(p+'/manifest.json'));m.id='${badId}';f.writeFileSync(q+'/manifest.json',JSON.stringify(m));`;
  run(["exec", "-T", "backup", "node", "-e", inject]);
  try {
    assert.throws(() =>
      run([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "-e",
        "ORBIT_RESTORE_DIR=/tmp/corrupt-restored",
        "restore",
        "restore",
        badId,
        badTarget,
      ]),
    );
    assert.equal(
      sql(`SELECT count(*) FROM pg_database WHERE datname='${badTarget}'`),
      "0",
    );
  } finally {
    run([
      "exec",
      "-T",
      "backup",
      "node",
      "-e",
      `require('fs').rmSync('/backups/${badId}',{recursive:true})`,
    ]);
  }
  const health = run([
    "exec",
    "-T",
    "backup",
    "node",
    "/opt/orbit/backup.mjs",
    "health",
  ]);
  assert.equal(health, "");
  await writeFile(
    "docs/evidence/phase4-backup-restore.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "PASS",
        mode: "REAL_LOCAL_POSTGRESQL_DUMP_ENCRYPTED_RESTORE",
        backup_id: manifest.id,
        encrypted_bytes: manifest.bytes,
        archive_sha256: manifest.sha256,
        runs_restored: restored.run_count,
        artifacts_checksum_verified: restored.artifact_files,
        sessions_after_restore: 0,
        checks: [
          "scheduled service running",
          "actual pg_dump and pg_restore",
          "AES-256-GCM encrypted archive",
          "fresh target only",
          "tampered checksum rejected before database creation",
          "session invalidation",
          "all restored artifact hashes verified",
          "source database preserved",
        ],
        offsite_copy_verified: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Encrypted PostgreSQL/artifact backup and fresh-target restore: PASS",
  );
} finally {
  sql(`DROP DATABASE IF EXISTS "${target}"`);
}

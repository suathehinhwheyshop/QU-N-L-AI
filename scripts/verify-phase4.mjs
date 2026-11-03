import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
const results = [];
const started = Date.now();
await mkdir("docs/evidence", { recursive: true });
async function command(name, program, args, env = {}) {
  const child = spawn(program, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  const code = await new Promise((r, j) => {
    child.once("exit", r);
    child.once("error", j);
  });
  await writeFile(".orbit/phase4-" + name + ".log", log);
  if (code !== 0) throw Error(name + " failed; see private .orbit log");
  results.push({ name, status: "PASS" });
  console.log(name + ": PASS");
}
const docker = [
  "--host=" + (process.env.ORBIT_DOCKER_HOST ?? "unix:///var/run/docker.sock"),
];
await command("regression", "npm", ["run", "verify:phase3"]);
await command("security", "node", ["ops/security-check.mjs"]);
await command("audit", "npm", ["audit", "--omit=dev", "--audit-level=high"]);
const build = [...docker, "build"];
if (process.env.CODEX_PROXY_CERT)
  build.push("--secret", "id=proxy_ca,src=" + process.env.CODEX_PROXY_CERT);
await command("image", "docker", [
  ...build,
  "-t",
  "orbit:phase4-candidate",
  ".",
]);
await command("ops-image", "docker", [
  ...docker,
  "build",
  "-f",
  "Dockerfile.ops",
  "-t",
  "orbit-ops:phase4-candidate",
  ".",
]);
try {
  await access(".orbit/staging/staging.env");
} catch {
  await command("config", "npm", ["run", "staging:config"]);
}
const compose = [
  ...docker,
  "compose",
  "--env-file",
  ".orbit/staging/staging.env",
  "-p",
  "orbit-phase4-local",
  "-f",
  "compose.staging.yml",
];
await command("bootstrap", "docker", [
  ...compose,
  "up",
  "-d",
  "db",
  "migrate",
  "grants",
  "storage-init",
]);
await command("provision", "docker", [
  ...compose,
  "run",
  "--rm",
  "--no-deps",
  "-T",
  "provision",
  "provision",
  "--email=admin@staging.orbit.test",
  "--password-file=/run/secrets/bootstrap_password",
]);
await command("start", "docker", [
  ...compose,
  "up",
  "-d",
  "--wait",
  "web",
  "worker",
  "tls",
  "backup",
]);
await command(
  "tls-staging",
  "node",
  ["--import", "tsx", "test/staging/verify.ts"],
  { ORBIT_STAGING_TEST_EMAIL: "admin@staging.orbit.test" },
);
await command("backup-restore", "node", [
  "--import",
  "tsx",
  "test/staging/backup.ts",
]);
await command("operations-recovery", "node", [
  "--import",
  "tsx",
  "test/staging/operations.ts",
]);
await command("monitor", "docker", [
  ...compose,
  "run",
  "--rm",
  "--no-deps",
  "-T",
  "provision",
  "monitor",
]);
await command("retention", "docker", [
  ...compose,
  "run",
  "--rm",
  "--no-deps",
  "-T",
  "provision",
  "artifact-retention",
]);
await writeFile(
  "docs/evidence/phase4-verification.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      started: new Date(started).toISOString(),
      status: "PASS",
      scope: "LOCAL_HTTPS_MOCK_HTTP_STUB",
      public_deployed: false,
      production_ready: false,
      gsc_live: "BLOCKED_MISSING_CREDENTIALS",
      ai_live: "BLOCKED_MISSING_CREDENTIALS",
      results,
    },
    null,
    2,
  ) + "\n",
);

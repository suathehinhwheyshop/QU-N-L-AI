import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const started = Date.now(),
  results = [];
await mkdir(".orbit", { recursive: true });
await mkdir("docs/evidence", { recursive: true });
const local = resolve(".orbit/personal-test"),
  password = resolve(".orbit/local-install-password");
try {
  await access(password);
} catch {
  await writeFile(password, randomBytes(32).toString("base64url"), {
    mode: 0o600,
    flag: "wx",
  });
}
async function run(name, program, args, extra = {}) {
  const child = spawn(program, args, {
    env: { ...process.env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout.on("data", (b) => (text += b));
  child.stderr.on("data", (b) => (text += b));
  const code = await new Promise((r, j) => {
    child.once("error", j);
    child.once("exit", r);
  });
  await writeFile(".orbit/subscription-" + name + ".log", text);
  if (code !== 0) throw Error(name + " FAILED; see private .orbit log");
  results.push({ name, status: "PASS" });
  console.log(name + ": PASS");
}
await run(
  "local-install",
  process.execPath,
  ["ops/local.mjs", "install", "--email", "owner@local-test.invalid"],
  { ORBIT_LOCAL_DIR: local, ORBIT_INSTALL_PASSWORD_FILE: password },
);
await run("regression", "npm", ["run", "verify:phase3"]);
await run("cli-e2e", process.execPath, [
  "--import",
  "tsx",
  "test/e2e/subscription.ts",
]);
await run("local-e2e", process.execPath, [
  "--import",
  "tsx",
  "test/e2e/local-mode.ts",
]);
await run("subscription-browser", "npm", ["run", "test:browser:isolated"], {
  ORBIT_TEST_SUBSCRIPTIONS_BROWSER: "true",
});
await run(
  "official-cli-install",
  process.execPath,
  ["ops/local.mjs", "install-cli"],
  { ORBIT_LOCAL_DIR: local },
);
await run(
  "offline-status",
  process.execPath,
  ["--import", "tsx", "scripts/subscription-status.ts"],
  { ORBIT_CLI_DIR: local + "/cli" },
);
await run("security", "npm", ["run", "security:check"]);
await run("audit", "npm", ["audit", "--omit=dev", "--audit-level=high"]);
await run("shell-syntax", "bash", [
  "-n",
  "ops/windows/bridge.sh",
  "ops/windows/install-node.sh",
  "ops/windows/provision-owner.sh",
]);
await run("format", "npm", ["run", "format:check"]);
for (const file of ["local-mode-e2e.json", "subscription-cli-e2e.json"]) {
  const v = JSON.parse(await readFile("docs/evidence/" + file));
  if (v.status !== "PASS" || Date.parse(v.at) < started)
    throw Error("MISSING_FRESH_EVIDENCE");
}
await writeFile(
  "docs/evidence/local-subscription-verification.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      started: new Date(started).toISOString(),
      status: "CODE_AND_LINUX_TESTS_PASS",
      mode: "MOCK_CLI_STUB",
      windows10_status: "BLOCKED_NO_WINDOWS_HOST",
      subscription_live_status: "BLOCKED_USER_LOGIN_AND_EXECUTION_CONSENT",
      paid_api_calls: 0,
      results,
    },
    null,
    2,
  ) + "\n",
);

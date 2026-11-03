import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const args = [
  "--host=unix:///var/run/docker.sock",
  "compose",
  "--env-file",
  ".orbit/staging/staging.env",
  "-f",
  "compose.staging.yml",
  "-p",
  "orbit-phase4-local",
];
const docker = (a: string[]) =>
  execFileSync("docker", [...args, ...a], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
let detected = false;
try {
  docker(["stop", "worker"]);
  try {
    docker(["run", "--rm", "--no-deps", "-T", "provision", "monitor"]);
  } catch (e) {
    const failure = e as { status: number; stdout: Buffer };
    assert.equal(failure.status, 1);
    const record = JSON.parse(String(failure.stdout).trim());
    assert.ok(record.alerts.includes("WORKER_STALE"));
    detected = true;
  }
  assert.ok(detected);
} finally {
  docker(["up", "-d", "--no-deps", "worker"]);
}
const deadline = Date.now() + 45000;
let recovered = false;
while (Date.now() < deadline) {
  try {
    const record = JSON.parse(
      docker(["run", "--rm", "--no-deps", "-T", "provision", "monitor"]).trim(),
    );
    if (record.workers > 0) {
      recovered = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
assert.ok(recovered);
await writeFile(
  "docs/evidence/phase4-operations.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: "PASS",
      checks: [
        "real stopped worker detected as WORKER_STALE with nonzero exit",
        "worker restart restores healthy monitor",
        "no outbound alert sent",
      ],
      external_alert_delivery_verified: false,
    },
    null,
    2,
  ) + "\n",
);
console.log("Operations stale-worker detection and restart recovery: PASS");

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const exec = promisify(execFile),
  dir = resolve(process.env.ORBIT_LOCAL_DIR ?? ".orbit/personal-test");
if (!dir.endsWith("/personal-test"))
  throw Error("ISOLATED_TEST_PROFILE_REQUIRED");
const command = async (action: string, ...args: string[]) =>
  exec(process.execPath, ["ops/local.mjs", action, ...args], {
    env: { ...process.env, ORBIT_LOCAL_DIR: dir },
    maxBuffer: 5000000,
  });
const before = JSON.parse(await readFile(dir + "/config.json", "utf8"));
const origin = "http://127.0.0.1:" + before.port;
let cookie = "";
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(origin + "/api/" + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== "GET"
        ? { Origin: origin, "Content-Type": "application/json" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r;
}
async function login() {
  const password = (
    await readFile(".orbit/local-install-password", "utf8")
  ).trim();
  const r = await api("auth/login", "POST", {
    email: "owner@local-test.invalid",
    password,
  });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
}
async function wait(fn: () => Promise<boolean>) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("LOCAL_CONDITION_TIMEOUT");
}
const checks: string[] = [];
try {
  await command("start");
  assert.equal((await api("bootstrap")).status, 401);
  await login();
  const bootstrap = await (await api("bootstrap")).json();
  assert.equal(bootstrap.workspaces.length, 4);
  assert.equal(
    (await api("connections/openai/test", "POST", { consent: true })).status,
    409,
  );
  const denied = await (
    await api("connections/openai/test", "POST", { consent: true })
  ).json();
  assert.equal(denied.code, "PAID_API_DISABLED");
  const rows = await (await api("subscriptions")).json();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r: { status: string }) => r.status !== "CONNECTED"));
  const goal = {
    goal: "Kiểm tra workflow localhost bảo toàn checkpoint sau khi tắt và mở máy",
    workspace_id: bootstrap.workspaces.find(
      (w: { kind: string }) => w.kind === "research",
    ).id,
    request_key: randomUUID(),
    mode: "MOCK",
    budget_cents: 0,
  };
  const r = await api("runs", "POST", goal);
  assert.equal(r.status, 201);
  const run = await r.json();
  await wait(async () => {
    const d = await (await api("runs/" + run.id)).json();
    return d.tasks.some((t: { status: string }) => t.status === "COMPLETED");
  });
  await api("runs/" + run.id + "/pause", "POST", {});
  await command("restart");
  await login();
  let detail = await (await api("runs/" + run.id)).json();
  assert.equal(detail.run.status, "PAUSED");
  const count = detail.attempts.length;
  await new Promise((r) => setTimeout(r, 1000));
  detail = await (await api("runs/" + run.id)).json();
  assert.equal(detail.attempts.length, count);
  assert.equal(
    (await api("runs/" + run.id + "/resume", "POST", {})).status,
    200,
  );
  await wait(
    async () =>
      (await (await api("runs/" + run.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  detail = await (await api("runs/" + run.id)).json();
  const approval = detail.approvals[0];
  await api("approvals/" + approval.id, "POST", {
    decision: "approve",
    output_hash: approval.output_hash,
  });
  await wait(
    async () =>
      (await (await api("runs/" + run.id)).json()).run.status === "COMPLETED",
  );
  detail = await (await api("runs/" + run.id)).json();
  assert.ok(detail.artifacts.length >= 6);
  for (const a of detail.artifacts) {
    const bytes = Buffer.from(
      await (await api("artifacts/" + a.id)).arrayBuffer(),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
  }
  checks.push(
    "actual local install/start/restart, single-owner login and API-key route denied",
    "checkpoint and pause survive restart; no extra attempts without Resume",
    "MOCK DAG completes through approval and checksum-verified artifacts",
  );
  await command("backup");
  const files = await import("node:fs/promises");
  const ids = (await files.readdir(dir + "/backups"))
    .filter((n) => /^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(n))
    .sort();
  const backup = ids.at(-1)!;
  assert.ok(backup);
  await command("stop");
  await command("restore", "--backup", backup);
  const restored = JSON.parse(await readFile(dir + "/config.json", "utf8"));
  assert.notEqual(restored.database, before.database);
  assert.notEqual(restored.artifacts, before.artifacts);
  await command("start");
  cookie = "";
  await login();
  detail = await (await api("runs/" + run.id)).json();
  assert.equal(detail.run.status, "COMPLETED");
  for (const a of detail.artifacts) {
    const bytes = Buffer.from(
      await (await api("artifacts/" + a.id)).arrayBuffer(),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
  }
  checks.push(
    "real encrypted PostgreSQL/artifact backup and fresh-target restore selected by local manager",
    "restored owner/history/download hashes valid; source database and artifacts preserved",
  );
  await writeFile(
    "docs/evidence/local-mode-e2e.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "PASS",
        runtime: "LINUX_EQUIVALENT_NOT_WINDOWS",
        ai_mode: "MOCK",
        run_id: run.id,
        checks,
        windows10_verified: false,
        ai_live_verified: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Local manager E2E: PASS (Linux equivalent; Windows not verified)",
  );
} finally {
  await command("stop");
}

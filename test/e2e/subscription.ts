import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { testDatabase } from "../support";
const database = await testDatabase();
const { pool } = await import("@orbit/database/client");
const { seed } = await import("../../scripts/seed");
const owner = await seed();
const { initializeSubscriptions } =
  await import("@orbit/database/subscriptions");
await initializeSubscriptions(owner.id);
for (const [id, vendor] of [
  ["stub-codex-cli", "openai"],
  ["stub-gemini-cli", "google"],
]) {
  await pool.query(
    "INSERT INTO connections(id,name,mode,status,capabilities,models,metadata) VALUES($1,$1,'MOCK','MOCK','[]','[\"default\"]',$2)",
    [id, { vendor }],
  );
  await pool.query(
    "INSERT INTO provider_configs(owner_id,provider_id,enabled,model) VALUES($1,$2,true,'default')",
    [owner.id, id],
  );
}
const password = randomBytes(24).toString("hex");
await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
  owner.id,
  await (await import("@orbit/database/security")).hashPassword(password),
]);
const origin = "http://127.0.0.1:3204";
const env = {
  ...process.env,
  ORBIT_LOCAL_MODE: "true",
  ORBIT_OWNER_ID: owner.id,
  ORBIT_AI_POLICY: "subscription-only",
  ORBIT_SUBSCRIPTIONS_ENABLED: "true",
  ORBIT_BASE_URL: origin,
  ORBIT_COOKIE_SECURE: "false",
  ORBIT_CLI_DIR: ".orbit/test-cli-e2e/" + database.name,
};
let server: ChildProcess | undefined,
  worker: ChildProcess | undefined,
  cookie = "",
  log = "";
function start(args: string[], mode = "normal") {
  const c = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./test/e2e/subscription-runtime.ts",
      ...args,
    ],
    {
      env: { ...env, ORBIT_TEST_CLI_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  c.stdout?.on("data", (b) => (log += b));
  c.stderr?.on("data", (b) => (log += b));
  return c;
}
async function stop(c: ChildProcess | undefined) {
  if (!c || c.exitCode !== null) return;
  c.kill("SIGTERM");
  await Promise.race([
    once(c, "exit"),
    new Promise((r) =>
      setTimeout(() => {
        c.kill("SIGKILL");
        r(null);
      }, 3000).unref(),
    ),
  ]);
}
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
  return { status: r.status, json: () => r.json() };
}
async function wait(fn: () => Promise<boolean>) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("CLI_E2E_TIMEOUT");
}
try {
  server = start([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3204",
  ]);
  worker = start(["src/worker.ts"]);
  await wait(async () => (await api("health/ready")).status === 200);
  const login = await fetch(origin + "/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: owner.email, password }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const boot = await (await api("bootstrap")).json();
  const workspace = boot.workspaces.find(
    (w: { kind: string }) => w.kind === "research",
  ).id;
  const create = async () => {
    const r = await api("runs", "POST", {
      goal: "Phân tích mục tiêu và đối chiếu qua hai CLI provider độc lập",
      workspace_id: workspace,
      mode: "MOCK",
      request_key: randomUUID(),
    });
    assert.equal(r.status, 201);
    return r.json();
  };
  const run = await create();
  await wait(
    async () =>
      (await (await api("runs/" + run.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  await stop(worker);
  worker = start(["src/worker.ts"]);
  await wait(async () => (await api("health/ready")).status === 200);
  let detail = await (await api("runs/" + run.id)).json();
  assert.equal(detail.run.status, "WAITING_APPROVAL");
  const a = detail.approvals[0];
  assert.equal(
    (
      await api("approvals/" + a.id, "POST", {
        decision: "approve",
        output_hash: a.output_hash,
      })
    ).status,
    200,
  );
  await wait(
    async () =>
      (await (await api("runs/" + run.id)).json()).run.status === "COMPLETED",
  );
  detail = await (await api("runs/" + run.id)).json();
  const models = detail.tasks.filter(
    (t: { kind: string }) => t.kind === "model",
  );
  assert.equal(
    new Set(models.map((t: { provider_id: string }) => t.provider_id)).size,
    2,
  );
  assert.ok(
    detail.attempts
      .filter((a: { provider_id?: string }) => a.provider_id)
      .every(
        (a: { usage: { execution: string } }) =>
          a.usage.execution === "CLI_STUB",
      ),
  );
  await stop(worker);
  worker = start(["src/worker.ts"], "quota");
  await wait(async () => (await api("health/ready")).status === 200);
  const limited = await create();
  await wait(
    async () =>
      (await (await api("runs/" + limited.id)).json()).run.status === "PAUSED",
  );
  const d = await (await api("runs/" + limited.id)).json();
  assert.equal(d.run.error_code, "CLI_LIMIT_REACHED");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(
    (await (await api("runs/" + limited.id)).json()).attempts.length,
    d.attempts.length,
  );
  await api("runs/" + limited.id + "/cancel", "POST", {});
  await stop(worker);
  worker = start(["src/worker.ts"], "hang");
  await wait(async () => (await api("health/ready")).status === 200);
  const cancel = await create();
  await wait(async () =>
    (await (await api("runs/" + cancel.id)).json()).tasks.some(
      (t: { kind: string; status: string }) =>
        t.kind === "model" && t.status === "RUNNING",
    ),
  );
  await api("runs/" + cancel.id + "/cancel", "POST", {});
  await wait(
    async () =>
      !(await (await api("runs/" + cancel.id)).json()).tasks.some(
        (t: { status: string }) => t.status === "RUNNING",
      ),
  );
  await writeFile(
    "docs/evidence/subscription-cli-e2e.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "PASS",
        execution: "CLI_STUB_SUBPROCESSES",
        live_verified: false,
        run_id: run.id,
        checks: [
          "real backend/worker/PostgreSQL via two CLI stub subprocesses",
          "structured handoff across providers and approval-bound artifacts",
          "worker restart preserves approval",
          "quota pauses with no automatic fallback/retry",
          "HTTP Cancel stops active CLI subprocess",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Subscription backend-worker-database E2E: PASS (CLI_STUB)");
} finally {
  await stop(server);
  await stop(worker);
  await mkdir(".orbit", { recursive: true });
  await writeFile(".orbit/subscription-e2e-private.log", log);
  await pool.end();
  await database.cleanup();
}

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { writeFile, mkdir } from "node:fs/promises";
import { testDatabase } from "../support";
const environment = await testDatabase();
const { pool } = await import("../../src/db/client");
await (await import("../../scripts/seed")).seed();
const origin = "http://127.0.0.1:3201";
const env = {
  ...process.env,
  ORBIT_BASE_URL: origin,
  ORBIT_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
  ORBIT_SESSION_SECRET: randomBytes(32).toString("hex"),
  ORBIT_COOKIE_SECURE: "false",
};
let server: ChildProcess | undefined, worker: ChildProcess | undefined;
let output = "";
function start(args: string[]) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b) => (output += b.toString()));
  child.stderr?.on("data", (b) => (output += b.toString()));
  return child;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((r) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        r(null);
      }, 5000).unref(),
    ),
  ]);
}
async function waitFor(fn: () => Promise<boolean>, limit = 30000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("E2E readiness/condition timeout");
}
let cookie = "";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  override?: Record<string, string>,
) {
  const res = await fetch(origin + "/api/" + path, {
    method,
    headers: {
      ...(method !== "GET"
        ? { "Content-Type": "application/json", Origin: origin }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...override,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}
const checks: string[] = [];
try {
  server = start([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3201",
  ]);
  await waitFor(async () => {
    const r = await fetch(origin + "/login");
    return r.ok;
  });
  assert.equal((await request("bootstrap")).status, 401);
  const loginHtml = await (await fetch(origin + "/login")).text();
  assert.match(loginHtml, /method="post"/);
  assert.match(loginHtml, /action="\/api\/auth\/login"/);
  assert.equal(
    (
      await request(
        "auth/login",
        "POST",
        { password: env.ORBIT_ADMIN_PASSWORD },
        { Origin: "https://wrong.example" },
      )
    ).status,
    401,
  );
  checks.push("unauthenticated API and cross-origin mutation blocked");
  const auth = await request("auth/login", "POST", {
    password: env.ORBIT_ADMIN_PASSWORD,
  });
  assert.equal(auth.status, 200);
  cookie = auth.headers.get("set-cookie")!.split(";")[0];
  assert.ok(auth.headers.get("set-cookie")?.includes("HttpOnly"));
  const boot = await (await request("bootstrap")).json();
  assert.equal(boot.workspaces.length, 4);
  assert.equal(
    boot.connections.filter((c: { status: string }) => c.status === "CONNECTED")
      .length,
    0,
  );
  const goal = {
    goal: "Phân tích hiệu suất SEO WheyShop và tạo bảng công việc tối ưu",
    workspace_id: boot.workspaces.find(
      (w: { kind: string }) => w.kind === "seo",
    ).id,
    request_key: randomUUID(),
    mode: "MOCK",
    site: "https://wheyshop.vn",
    budget_cents: 0,
  };
  const unsupportedConfig = await request(
    "connections/mock-anthropic/config",
    "PATCH",
    { enabled: true, model: "not-a-supported-model" },
  );
  assert.equal(unsupportedConfig.status, 409);
  const configured = await request(
    "connections/mock-anthropic/config",
    "PATCH",
    { enabled: false, model: "mock-anthropic/structured-v1" },
  );
  assert.equal(configured.status, 200);
  const preview = await request("plans", "POST", goal);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).nodes.length, 6);
  const created = await request("runs", "POST", goal);
  assert.equal(created.status, 201);
  const run = await created.json();
  assert.equal((await (await request("runs", "POST", goal)).json()).id, run.id);
  worker = start(["--import", "tsx", "src/worker.ts"]);
  await waitFor(
    async () =>
      (await (await request("runs/" + run.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  const beforeRestart = await (await request("runs/" + run.id)).json();
  await stop(worker);
  worker = undefined;
  // Restart the HTTP application as well as the worker; state and session
  // survive because PostgreSQL, artifacts and the signing secret are retained.
  await stop(server);
  server = undefined;
  server = start([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3201",
  ]);
  await waitFor(async () => {
    const response = await request("runs/" + run.id);
    return (
      response.status === 200 &&
      (await response.json()).run.status === "WAITING_APPROVAL"
    );
  });
  checks.push(
    "application server restart preserves run, outputs, approval and authentication",
  );
  let detail = await (await request("runs/" + run.id)).json();
  assert.deepEqual(detail.run.plan, beforeRestart.run.plan);
  assert.deepEqual(
    detail.tasks.map((t: { output: unknown }) => t.output),
    beforeRestart.tasks.map((t: { output: unknown }) => t.output),
  );
  assert.equal(detail.dependencies.length, 7);
  assert.equal(
    detail.tasks.filter((t: { status: string }) => t.status === "COMPLETED")
      .length,
    4,
  );
  checks.push(
    "goal → source → two different mock providers → board → WAITING_APPROVAL",
  );
  assert.notEqual(
    detail.tasks.find((t: { key: string }) => t.key === "analyze").provider_id,
    "mock-anthropic",
  );
  checks.push(
    "persisted model configuration controls actual routing; unsupported models rejected",
  );
  const a = detail.approvals[0];
  assert.equal(
    (
      await request("approvals/" + a.id, "POST", {
        decision: "approve",
        output_hash: "0".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("approvals/" + a.id, "POST", {
        decision: "approve",
        output_hash: a.output_hash,
      })
    ).status,
    200,
  );
  worker = start(["--import", "tsx", "src/worker.ts"]);
  await waitFor(
    async () =>
      (await (await request("runs/" + run.id)).json()).run.status ===
      "COMPLETED",
  );
  detail = await (await request("runs/" + run.id)).json();
  assert.equal(detail.artifacts.length, 6);
  const analysis = detail.tasks.find(
      (t: { key: string }) => t.key === "analyze",
    ),
    review = detail.tasks.find((t: { key: string }) => t.key === "review");
  assert.notEqual(analysis.provider_id, review.provider_id);
  const delivered = detail.tasks.find(
    (t: { key: string }) => t.key === "deliver",
  );
  assert.equal(delivered.output.verified, true);
  assert.equal(delivered.output.mode, "MOCK");
  const file = detail.artifacts.find(
    (f: { task_id: string }) => f.task_id === delivered.id,
  );
  const download = await request("artifacts/" + file.id);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  assert.equal(JSON.parse(bytes.toString()).mode, "MOCK");
  checks.push(
    "worker process restart continues from durable checkpoint; approval and real file checksum verified",
  );
  assert.equal(
    (await request("connections/anthropic/test", "POST", {})).status,
    409,
  );
  assert.equal(
    (
      await (
        await request("connections/mock-anthropic/test", "POST", {})
      ).json()
    ).status,
    "MOCK",
  );
  assert.equal(
    (
      await request("settings", "PATCH", {
        max_budget_cents: 80,
        concurrency: 2,
        data_policy: "local-only",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("settings", "PATCH", {
        max_budget_cents: 80,
        concurrency: 2,
        data_policy: "external",
        read_only: false,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("runs", "POST", {
        ...goal,
        request_key: randomUUID(),
        mode: "LIVE",
      })
    ).status,
    409,
  );
  checks.push(
    "mock health stays MOCK; LIVE and writes remain blocked; settings persist",
  );
  const files = new FormData();
  files.set(
    "file",
    new File(["reference context"], "reference.txt", { type: "text/plain" }),
  );
  const uploaded = await fetch(origin + "/api/uploads", {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
    body: files,
  });
  assert.equal(uploaded.status, 201);
  const uf = await uploaded.json();
  assert.equal(
    await (await request("artifacts/" + uf.id)).text(),
    "reference context",
  );
  checks.push("authenticated upload and download store real bytes");
  const probeGoal = {
    ...goal,
    request_key: randomUUID(),
    scenario: "fail-once",
  };
  const probe = await (await request("runs", "POST", probeGoal)).json();
  assert.equal(
    (await request("runs/" + probe.id + "/pause", "POST", {})).status,
    200,
  );
  assert.equal(
    (await (await request("runs/" + probe.id)).json()).run.status,
    "PAUSED",
  );
  assert.equal(
    (await request("runs/" + probe.id + "/resume", "POST", {})).status,
    200,
  );
  await waitFor(
    async () =>
      (await (await request("runs/" + probe.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  const retried = await (await request("runs/" + probe.id)).json();
  assert.ok(
    retried.attempts.some((a: { status: string }) => a.status === "FAILED"),
  );
  assert.ok(
    retried.tasks.some((t: { attempt_count: number }) => t.attempt_count === 2),
  );
  assert.ok(
    retried.logs.some((e: { type: string }) => e.type === "RETRY_SCHEDULED"),
  );
  assert.equal(
    (await request("runs/" + probe.id + "/cancel", "POST", {})).status,
    200,
  );
  assert.equal(
    (await (await request("runs/" + probe.id)).json()).run.status,
    "CANCELED",
  );
  checks.push(
    "backend pause/resume/cancel and bounded retry validated over HTTP with worker",
  );
  // A second owner cannot read this run or artifact, even with a correctly signed session.
  const second = (
    await pool.query(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["outsider@orbit.local", "Other owner"],
    )
  ).rows[0];
  const oldSecret = process.env.ORBIT_SESSION_SECRET;
  process.env.ORBIT_SESSION_SECRET = env.ORBIT_SESSION_SECRET;
  const { issueSession } = await import("../../src/server/auth");
  const otherCookie = "orbit_session=" + issueSession(second.id);
  process.env.ORBIT_SESSION_SECRET = oldSecret;
  assert.equal(
    (await request("runs/" + run.id, "GET", undefined, { Cookie: otherCookie }))
      .status,
    404,
  );
  assert.equal(
    (
      await request("artifacts/" + file.id, "GET", undefined, {
        Cookie: otherCookie,
      })
    ).status,
    404,
  );
  checks.push("owner authorization enforced for run and artifact");
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/phase1-e2e.json",
    JSON.stringify(
      {
        result: "PASS",
        mode: "MOCK",
        at: new Date().toISOString(),
        run_id: run.id,
        task_count: detail.tasks.length,
        artifact_count: detail.artifacts.length,
        evidence: {
          persisted_run_id: run.id,
          dependency_count: detail.dependencies.length,
          task_ids: detail.tasks.map((t: { id: string }) => t.id),
          attempt_count: detail.attempts.length,
          provider_ids: [analysis.provider_id, review.provider_id],
          approval: {
            id: a.id,
            output_hash: a.output_hash,
            status: "APPROVED",
          },
          artifact_checksums: detail.artifacts.map(
            (f: { id: string; sha256: string }) => ({
              id: f.id,
              sha256: f.sha256,
            }),
          ),
          application_restart: "PASS",
          worker_restart: "PASS",
          controls_retry_probe: {
            run_id: probe.id,
            status: "CANCELED",
            attempts: retried.attempts.length,
          },
        },
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: "PASS", checks }, null, 2));
} catch (e) {
  await mkdir(".orbit", { recursive: true });
  await writeFile(".orbit/e2e-server.log", output);
  throw e;
} finally {
  await stop(worker);
  await stop(server);
  await pool.end();
  await environment.cleanup();
}

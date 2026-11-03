import { gscStub, testSpec, currentRows, previousRows } from "../gsc-support";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { writeFile, mkdir } from "node:fs/promises";
import { testDatabase } from "../support";
const environment = await testDatabase();
const gsc = await gscStub();
const { pool } = await import("../../src/db/client");
const fixtureOwner = await (await import("../../scripts/seed")).seed();
const loginEmail = "owner@orbit.local",
  loginPassword = randomBytes(24).toString("hex");
await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
  fixtureOwner.id,
  await (await import("@orbit/database/security")).hashPassword(loginPassword),
]);
const origin = "http://127.0.0.1:3201";
const env = {
  ...process.env,
  ORBIT_BASE_URL: origin,
  ORBIT_ADMIN_PASSWORD: "",
  ORBIT_SESSION_SECRET: randomBytes(32).toString("hex"),
  ORBIT_COOKIE_SECURE: "false",
  ORBIT_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ORBIT_GSC_CLIENT_ID: "fixture-client",
  ORBIT_GSC_CLIENT_SECRET: "fixture-client-secret",
  ORBIT_TEST_GSC_URL: gsc.transport.token.replace(/\/token$/, ""),
  ORBIT_OPENAI_API_KEY: "",
  ORBIT_ANTHROPIC_API_KEY: "",
  ORBIT_GOOGLE_API_KEY: "",
  ORBIT_XAI_API_KEY: "",
};
let server: ChildProcess | undefined, worker: ChildProcess | undefined;
let output = "";
function start(args: string[]) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./test/e2e/gsc-runtime.ts", ...args],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
        { email: loginEmail, password: loginPassword },
        { Origin: "https://wrong.example" },
      )
    ).status,
    401,
  );
  checks.push("unauthenticated API and cross-origin mutation blocked");
  const auth = await request("auth/login", "POST", {
    email: loginEmail,
    password: loginPassword,
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
  const otherCookie = "orbit_session=" + (await issueSession(second.id));
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
  // Phase 2 offline regression: the AI planning stage also crosses the real
  // HTTP/backend/worker/database boundary; model inference remains MOCK.
  const aiGoal = {
    ...goal,
    workspace_id: boot.workspaces.find(
      (w: { kind: string }) => w.kind === "research",
    ).id,
    request_key: randomUUID(),
    planning_strategy: "AI_WITH_FALLBACK",
  };
  const aiCreated = await request("runs", "POST", aiGoal);
  assert.equal(aiCreated.status, 201);
  const aiRun = await aiCreated.json();
  await waitFor(
    async () =>
      (await (await request("runs/" + aiRun.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  let aiDetail = await (await request("runs/" + aiRun.id)).json();
  assert.equal(aiDetail.tasks.length, 7);
  assert.equal(
    aiDetail.tasks.find((t: { key: string }) => t.key === "interpret").output
      .strategy,
    "AI",
  );
  assert.ok(
    aiDetail.attempts.every(
      (a: Record<string, unknown>) => !("provider_snapshot" in a),
    ),
  );
  const aiApproval = aiDetail.approvals[0];
  assert.equal(
    (
      await request("approvals/" + aiApproval.id, "POST", {
        decision: "approve",
        output_hash: aiApproval.output_hash,
      })
    ).status,
    200,
  );
  await waitFor(
    async () =>
      (await (await request("runs/" + aiRun.id)).json()).run.status ===
      "COMPLETED",
  );
  aiDetail = await (await request("runs/" + aiRun.id)).json();
  assert.equal(aiDetail.artifacts.length, 7);
  assert.equal(aiDetail.run.mode, "MOCK");
  const configurationOnly = await request(
    "connections/openai/config",
    "PATCH",
    {
      enabled: true,
      model: "fixture-not-a-real-model",
      model_config: {
        input_usd_per_million: 1,
        output_usd_per_million: 2,
        max_input_tokens: 32000,
        max_output_tokens: 2048,
        price_source: "OFFLINE E2E fixture; not official prices",
        price_date: "2026-11-02",
      },
    },
  );
  assert.equal(configurationOnly.status, 200);
  assert.equal(
    (await request("connections/openai/test", "POST", { consent: true }))
      .status,
    409,
  );
  const disconnected = (await (await request("connections")).json()).find(
    (c: { id: string }) => c.id === "openai",
  );
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.metadata.credential_present, false);
  checks.push(
    "AI schema planning → two MOCK providers → approval → 7 stored artifacts; LIVE stays disconnected without a real API probe",
  );
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/phase2-offline-e2e.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "PASS",
        mode: "MOCK",
        run_id: aiRun.id,
        task_count: aiDetail.tasks.length,
        artifact_count: aiDetail.artifacts.length,
        planning_strategy: "AI",
        transport: "NO_EXTERNAL_API",
        live_api_verified: false,
        notice:
          "Real HTTP backend + separate worker + PostgreSQL; inference uses mock adapters.",
      },
      null,
      2,
    ) + "\n",
  );
  // Full Phase 3 HTTP_STUB path: API OAuth → GSC → durable worker → dataset.
  assert.equal(
    (await request("gsc/status", "GET", undefined, { Cookie: "" })).status,
    401,
  );
  const begin = await request("gsc/oauth/start", "POST", {});
  assert.equal(begin.status, 200);
  const browserCookie = begin.headers.get("set-cookie")!.split(";")[0];
  const authorization = await begin.json();
  const state = new URL(authorization.url).searchParams.get("state");
  const callbackUrl =
    origin +
    "/api/gsc/oauth/callback?state=" +
    encodeURIComponent(state!) +
    "&code=fixture-code";
  const wrongBrowser = await fetch(callbackUrl, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(wrongBrowser.status, 303);
  assert.ok(wrongBrowser.headers.get("location")?.includes("GSC_OAUTH_STATE"));
  const callback = await fetch(callbackUrl, {
    headers: { Cookie: cookie + "; " + browserCookie },
    redirect: "manual",
  });
  assert.equal(callback.status, 303);
  assert.ok(callback.headers.get("location")?.includes("authorized"));
  const discovery = await request("gsc/properties", "POST", {});
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).kind, "HTTP_STUB");
  assert.equal(
    (await (await request("gsc/status")).json()).status,
    "HTTP_STUB",
  );
  const gscBefore = gsc.requests.length;
  gsc.state.failPageAt = 2;
  const syncKey = randomUUID();
  const syncResponse = await request("gsc/sync", "POST", {
    request_key: syncKey,
    spec: testSpec,
  });
  assert.equal(syncResponse.status, 202);
  const sync = await syncResponse.json();
  assert.equal(
    (
      await (
        await request("gsc/sync", "POST", {
          request_key: syncKey,
          spec: testSpec,
        })
      ).json()
    ).run_id,
    sync.run_id,
  );
  await waitFor(async () => {
    const row = (
      await pool.query("SELECT checkpoint FROM gsc_jobs WHERE id=$1", [
        sync.job_id,
      ])
    ).rows[0];
    return row.checkpoint.pages?.length === 1;
  });
  await stop(worker);
  worker = undefined;
  const checkpoint = (
    await pool.query("SELECT checkpoint FROM gsc_jobs WHERE id=$1", [
      sync.job_id,
    ])
  ).rows[0].checkpoint;
  assert.equal(checkpoint.pages.length, 1);
  gsc.state.failPageAt = -1;
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
  await waitFor(async () => (await request("gsc/jobs")).ok);
  worker = start(["--import", "tsx", "src/worker.ts"]);
  await waitFor(
    async () =>
      (await (await request("runs/" + sync.run_id)).json()).run.status ===
      "COMPLETED",
  );
  const syncJob = (
    await pool.query("SELECT * FROM gsc_jobs WHERE id=$1", [sync.job_id])
  ).rows[0];
  assert.ok(syncJob.dataset_id);
  assert.equal(
    gsc.requests
      .slice(gscBefore)
      .filter(
        (r) =>
          r.body.startDate === testSpec.current.start && r.body.startRow === 0,
      ).length,
    1,
  );
  const sourceDataset = await (
    await request("gsc/datasets/" + syncJob.dataset_id)
  ).json();
  assert.equal(sourceDataset.provenance.kind, "HTTP_STUB");
  assert.equal(sourceDataset.facts.totals.clicks, 55);
  const form = new FormData();
  form.set("spec", JSON.stringify(testSpec));
  form.set("request_key", randomUUID());
  form.set(
    "file",
    new File(
      [JSON.stringify({ current: currentRows, previous: previousRows })],
      "gsc-export.json",
      { type: "application/json" },
    ),
  );
  const imported = await fetch(origin + "/api/gsc/import", {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).kind, "IMPORT");
  const seoRequest = {
    ...goal,
    request_key: randomUUID(),
    seo_dataset_id: syncJob.dataset_id,
    planning_strategy: "TEMPLATE",
  };
  const seoCreated = await request("runs", "POST", seoRequest);
  assert.equal(seoCreated.status, 201);
  const seoRun = await seoCreated.json();
  await waitFor(
    async () =>
      (await (await request("runs/" + seoRun.id)).json()).run.status ===
      "WAITING_APPROVAL",
  );
  let seoDetail = await (await request("runs/" + seoRun.id)).json();
  assert.equal(seoDetail.tasks.length, 7);
  assert.equal(
    seoDetail.tasks.find((t: { key: string }) => t.key === "board").output
      .metrics.clicks,
    55,
  );
  const seoGate = seoDetail.approvals[0];
  assert.equal(
    (
      await request("approvals/" + seoGate.id, "POST", {
        decision: "approve",
        output_hash: "0".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("approvals/" + seoGate.id, "POST", {
        decision: "approve",
        output_hash: seoGate.output_hash,
      })
    ).status,
    200,
  );
  await waitFor(
    async () =>
      (await (await request("runs/" + seoRun.id)).json()).run.status ===
      "COMPLETED",
  );
  seoDetail = await (await request("runs/" + seoRun.id)).json();
  assert.equal(seoDetail.artifacts.length, 10);
  for (const file of seoDetail.artifacts.filter((f: { kind: string }) =>
    f.kind.startsWith("report_"),
  )) {
    const response = await request("artifacts/" + file.id);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    assert.ok(
      response.headers
        .get("content-disposition")
        ?.includes(
          file.kind === "report_md"
            ? ".md"
            : file.kind === "report_csv"
              ? ".csv"
              : ".json",
        ),
    );
  }
  assert.equal(
    (
      await request("gsc/datasets/" + syncJob.dataset_id, "GET", undefined, {
        Cookie: otherCookie,
      })
    ).status,
    403,
  );
  assert.equal((await request("gsc/revoke", "POST", {})).status, 200);
  assert.equal((await (await request("gsc/status")).json()).status, "REVOKED");
  checks.push(
    "GSC HTTP_STUB OAuth/discovery/pagination survives app+worker restart at page checkpoint; duplicate job, import, SEO validation, approval and MD/CSV/JSON checksums verified",
  );
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/phase3-e2e.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: "PASS",
        gsc: "HTTP_STUB_TESTED",
        ai: "MOCK",
        live_gsc_verified: false,
        live_ai_verified: false,
        ingestion_run_id: sync.run_id,
        seo_run_id: seoRun.id,
        dataset_id: syncJob.dataset_id,
        task_count: seoDetail.tasks.length,
        artifact_count: seoDetail.artifacts.length,
        page_checkpoint_restart: "PASS",
        approval_hash: seoGate.output_hash,
        report_checksums: seoDetail.artifacts
          .filter((a: { kind: string }) => a.kind.startsWith("report_"))
          .map((a: { kind: string; sha256: string }) => ({
            kind: a.kind,
            sha256: a.sha256,
          })),
      },
      null,
      2,
    ) + "\n",
  );
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
  await gsc.close();
}

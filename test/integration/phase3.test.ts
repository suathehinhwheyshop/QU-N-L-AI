import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { testDatabase } from "../support";
import { gscStub, testSpec, currentRows, previousRows } from "../gsc-support";
import { stubApi, stubProfile } from "../phase2-support";
import { GscOAuth } from "@orbit/integrations/gsc-oauth";
import { GscClient } from "@orbit/integrations/gsc-client";
import {
  beginSync,
  collectDataset,
  importDataset,
  loadDataset,
} from "@orbit/integrations/seo-data";
import { workspaceHandlers } from "@orbit/workspaces/handlers";
import { installRegistry, getProvider } from "@orbit/core/registry";
import { integrations } from "@orbit/integrations/registry";
import { createLiveAdapter } from "@orbit/providers/live-adapter";
import { wires } from "@orbit/providers/live-registry";
import { GoalInput } from "@orbit/shared/contracts";
let env: Awaited<ReturnType<typeof testDatabase>>,
  gsc: Awaited<ReturnType<typeof gscStub>>,
  ai: Awaited<ReturnType<typeof stubApi>>,
  oauth: GscOAuth,
  client: GscClient,
  pool: (typeof import("@orbit/database/client"))["pool"],
  engine: typeof import("@orbit/core/engine"),
  owner: string,
  workspace: string,
  datasetId: string;
const signal = () => new AbortController().signal;
async function connect() {
  const start = await oauth.begin(owner);
  await oauth.callback(
    new URL(start.url).searchParams.get("state")!,
    start.browser,
    "fixture-code",
    signal(),
  );
  await client.discover(owner, signal());
}
before(async () => {
  env = await testDatabase();
  process.env.ORBIT_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.ORBIT_GSC_CLIENT_ID = "stub-client";
  process.env.ORBIT_GSC_CLIENT_SECRET = "stub-client-secret";
  await import("../../src/server/runtime");
  pool = (await import("@orbit/database/client")).pool;
  engine = await import("@orbit/core/engine");
  owner = (await (await import("../../scripts/seed")).seed()).id;
  workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='seo'",
      [owner],
    )
  ).rows[0].id;
  gsc = await gscStub();
  oauth = new GscOAuth(gsc.transport);
  client = new GscClient(oauth, 2, 50000);
  ai = await stubApi();
  const adapters = wires.slice(0, 2).map((w) => {
    const p = createLiveAdapter(
      w,
      {
        kind: "HTTP_STUB",
        baseUrl: ai.url + "/" + w.id,
        fetch: (u, i) => fetch(u, i),
      },
      () => "fixture-api-key",
    );
    p.descriptor.model = "stub-model";
    p.descriptor.models = ["stub-model"];
    p.descriptor.costCents = 4;
    return p;
  });
  installRegistry({
    providers: adapters,
    handlers: {
      ...workspaceHandlers,
      "gsc.collect": {
        ...workspaceHandlers["gsc.collect"],
        execute: (ctx) => collectDataset(ctx, client),
      },
    },
    integrations,
  });
  for (const p of adapters) {
    await pool.query(
      "INSERT INTO connections(id,name,mode,status,capabilities,models,metadata) VALUES($1,$1,'MOCK','MOCK',$2,$3,'{}')",
      [
        p.descriptor.id,
        JSON.stringify(p.descriptor.capabilities),
        JSON.stringify(["stub-model"]),
      ],
    );
    await pool.query(
      "INSERT INTO provider_configs(owner_id,provider_id,enabled,model,model_config) VALUES($1,$2,true,$3,$4)",
      [owner, p.descriptor.id, "stub-model", stubProfile],
    );
  }
});
after(async () => {
  await gsc?.close();
  await ai?.close();
  await pool?.end();
  await env?.cleanup();
});
const get = async (id: string) =>
  (await pool.query("SELECT * FROM runs WHERE id=$1", [id])).rows[0];
async function until(id: string, status: string) {
  for (let n = 0; n < 70; n++) {
    if ((await get(id)).status === status) return;
    await engine.tick(2);
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal((await get(id)).status, status);
}
const goal = () =>
  GoalInput.parse({
    goal: "Phân tích dữ liệu GSC và tạo bảng việc SEO có bằng chứng",
    workspace_id: workspace,
    seo_dataset_id: datasetId,
    request_key: randomUUID(),
    budget_cents: 100,
  });
test("OAuth PKCE/state/browser nonce is one-use, tokens encrypted and DTO contains no credential", async () => {
  const start = await oauth.begin(owner);
  const url = new URL(start.url);
  assert.equal(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/webmasters.readonly",
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const state = url.searchParams.get("state")!;
  await assert.rejects(
    () => oauth.callback(state, "wrong-browser", "fixture-code", signal()),
    /GSC_OAUTH_STATE/,
  );
  await oauth.callback(state, start.browser, "fixture-code", signal());
  await assert.rejects(
    () => oauth.callback(state, start.browser, "fixture-code", signal()),
    /GSC_OAUTH_STATE/,
  );
  const row = (
    await pool.query("SELECT * FROM gsc_accounts WHERE owner_id=$1", [owner])
  ).rows[0];
  assert.ok(!row.access_cipher.includes("test-access"));
  assert.ok(!row.refresh_cipher.includes("test-refresh"));
  assert.ok(!JSON.stringify(await oauth.status(owner)).includes("cipher"));
  assert.equal((await client.discover(owner, signal())).kind, "HTTP_STUB");
  assert.equal((await oauth.status(owner)).status, "HTTP_STUB");
  await assert.rejects(
    () => new GscOAuth().access(owner, signal()),
    /GSC_DISCONNECTED/,
  );
  await assert.rejects(
    () => new GscOAuth().revoke(owner, signal()),
    /GSC_DISCONNECTED/,
  );
  assert.equal((await oauth.status(owner)).status, "HTTP_STUB");
});
test("expired tokens refresh once under concurrency; API 401 retries once, 403 remains permission error", async () => {
  await pool.query(
    "UPDATE gsc_accounts SET expires_at=now()-interval '1 minute' WHERE owner_id=$1",
    [owner],
  );
  const before = gsc.state.refreshes;
  await Promise.all([
    oauth.access(owner, signal()),
    oauth.access(owner, signal()),
    oauth.access(owner, signal()),
  ]);
  assert.equal(gsc.state.refreshes, before + 1);
  gsc.state.denyAccessOnce = true;
  await client.discover(owner, signal());
  assert.equal(gsc.state.refreshes, before + 2);
  gsc.state.apiStatus = 403;
  try {
    await assert.rejects(
      () => client.discover(owner, signal()),
      /GSC_FORBIDDEN/,
    );
  } finally {
    gsc.state.apiStatus = 200;
  }
});
test("invalid_grant requires reconnect and revoke clears encrypted tokens; no reads after revocation", async () => {
  await pool.query(
    "UPDATE gsc_accounts SET expires_at=now()-interval '1 minute' WHERE owner_id=$1",
    [owner],
  );
  gsc.state.tokenStatus = 400;
  try {
    await assert.rejects(
      () => oauth.access(owner, signal()),
      /GSC_REAUTH_REQUIRED/,
    );
    assert.equal((await oauth.status(owner)).status, "REAUTH_REQUIRED");
  } finally {
    gsc.state.tokenStatus = 200;
  }
  await connect();
  await oauth.revoke(owner, signal());
  assert.equal((await oauth.status(owner)).status, "REVOKED");
  assert.equal(
    (
      await pool.query(
        "SELECT refresh_cipher FROM gsc_accounts WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].refresh_cipher,
    null,
  );
  await assert.rejects(() => oauth.access(owner, signal()), /GSC_DISCONNECTED/);
  await connect();
});
test("CSV/JSON import stores immutable source/checksum, idempotent keys, period metadata and owner isolation", async () => {
  const raw = Buffer.from(
      JSON.stringify({ current: currentRows, previous: previousRows }),
    ),
    key = randomUUID();
  const [a, b] = await Promise.all([
    importDataset(owner, key, testSpec, "export.json", raw, "json"),
    importDataset(owner, key, testSpec, "export.json", raw, "json"),
  ]);
  assert.equal(a.id, b.id);
  datasetId = String(a.id);
  assert.equal(a.kind, "IMPORT");
  assert.ok(!("blob_key" in a));
  await assert.rejects(
    () =>
      importDataset(
        owner,
        key,
        { ...testSpec, country: "vnm" },
        "export.json",
        raw,
        "json",
      ),
    /CONFLICT/,
  );
  const loaded = await loadDataset(owner, datasetId);
  assert.equal(loaded.data.current.length, 3);
  assert.ok(loaded.row.raw_sha256);
  await assert.rejects(() => loadDataset(randomUUID(), datasetId), /NOT_FOUND/);
  const csv = Buffer.from(
    "period,page,query,clicks,impressions,position\n" +
      currentRows
        .map((r) =>
          [
            "current",
            r.page,
            r.query,
            r.clicks,
            r.impressions,
            r.position,
          ].join(","),
        )
        .join("\n"),
  );
  const imported = await importDataset(
    owner,
    randomUUID(),
    { ...testSpec, previous: undefined },
    "export.csv",
    csv,
    "csv",
  );
  assert.equal(imported.row_count, 3);
});
test("GSC pagination is a durable engine tool job, duplicate jobs reuse run/dataset and preserve API request filters", async () => {
  const key = randomUUID();
  const [a, b] = await Promise.all([
    beginSync(owner, key, testSpec, client),
    beginSync(owner, key, testSpec, client),
  ]);
  assert.equal(a.run_id, b.run_id);
  await until(a.run_id, "COMPLETED");
  const job = (
    await pool.query("SELECT * FROM gsc_jobs WHERE id=$1", [a.job_id])
  ).rows[0];
  assert.equal(job.checkpoint.pages.length, 4);
  const data = await loadDataset(owner, job.dataset_id);
  assert.equal(data.data.provenance.kind, "HTTP_STUB");
  assert.equal(data.data.current.length, 3);
  assert.equal(data.data.previous.length, 2);
  assert.ok(data.data.provenance.warnings.length >= 2);
  assert.equal((await get(a.run_id)).spent_cents, 0);
  await assert.rejects(
    () => beginSync(owner, key, { ...testSpec, device: "mobile" }, client),
    /CONFLICT/,
  );
  const q = gsc.requests.find((r) => r.body.startRow === 2);
  assert.deepEqual(q?.body.dimensions, ["page", "query"]);
  assert.equal(q?.body.dataState, "final");
});
test("429 resumes a persisted page checkpoint, without refetching prior pages or duplicate dataset", async () => {
  const start = gsc.requests.length;
  gsc.state.failPageAt = 2;
  const r = await beginSync(owner, randomUUID(), testSpec, client);
  await engine.tick(1);
  let job = (await pool.query("SELECT * FROM gsc_jobs WHERE id=$1", [r.job_id]))
    .rows[0];
  assert.equal(job.checkpoint.pages.length, 1);
  const task = (
    await pool.query("SELECT * FROM tasks WHERE run_id=$1", [r.run_id])
  ).rows[0];
  assert.equal(task.status, "PENDING");
  assert.equal(task.error_code, "GSC_RATE_LIMIT");
  const failedAttempt = (
    await pool.query(
      "SELECT finished_at FROM attempts WHERE task_id=$1 ORDER BY number DESC LIMIT 1",
      [task.id],
    )
  ).rows[0];
  assert.ok(
    new Date(task.next_attempt_at).getTime() -
      new Date(failedAttempt.finished_at).getTime() >=
      1000,
  );
  gsc.state.failPageAt = -1;
  await pool.query("UPDATE tasks SET next_attempt_at=now() WHERE id=$1", [
    task.id,
  ]);
  await until(r.run_id, "COMPLETED");
  job = (await pool.query("SELECT * FROM gsc_jobs WHERE id=$1", [r.job_id]))
    .rows[0];
  assert.ok(job.dataset_id);
  assert.equal(
    gsc.requests
      .slice(start)
      .filter(
        (x) =>
          x.body.startDate === testSpec.current.start && x.body.startRow === 0,
      ).length,
    1,
  );
});
test("expired lease fences late GSC page commits, a recovered attempt produces one dataset", async () => {
  const r = await beginSync(owner, randomUUID(), testSpec, client);
  const old = await engine.claimTask();
  assert.equal(old?.run.id, r.run_id);
  await pool.query(
    "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
    [old!.task.id],
  );
  await engine.recoverExpired();
  await pool.query("UPDATE tasks SET next_attempt_at=now() WHERE id=$1", [
    old!.task.id,
  ]);
  const fresh = await engine.claimTask();
  await engine.executeClaim(old!);
  assert.deepEqual(
    (
      await pool.query("SELECT checkpoint FROM gsc_jobs WHERE id=$1", [
        r.job_id,
      ])
    ).rows[0].checkpoint,
    {},
  );
  await engine.executeClaim(fresh!);
  assert.equal((await get(r.run_id)).status, "COMPLETED");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM seo_datasets WHERE job_id=$1",
        [r.job_id],
      )
    ).rows[0].n,
    1,
  );
});
test("two HTTP_STUB AI providers → code validation → synthesis → hash approval → MD/CSV/JSON artifacts", async () => {
  const r = await engine.createWorkflow(owner, goal());
  await until(r.id, "WAITING_APPROVAL");
  const tasks = (
    await pool.query("SELECT * FROM tasks WHERE run_id=$1", [r.id])
  ).rows;
  assert.equal(tasks.length, 7);
  assert.notEqual(
    tasks.find((t) => t.key === "analyze").provider_id,
    tasks.find((t) => t.key === "review").provider_id,
  );
  const board = tasks.find((t) => t.key === "board").output;
  assert.equal(board.metrics.clicks, 55);
  assert.equal(board.source_kind, "IMPORT");
  assert.ok(tasks.find((t) => t.key === "validate").output.reviewed);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM artifacts WHERE run_id=$1 AND kind LIKE 'report_%'",
        [r.id],
      )
    ).rows[0].n,
    0,
  );
  const a = (
    await pool.query("SELECT * FROM approvals WHERE run_id=$1", [r.id])
  ).rows[0];
  await assert.rejects(
    () => engine.decideApproval(owner, a.id, "approve", "0".repeat(64)),
    /CONFLICT/,
  );
  await engine.decideApproval(owner, a.id, "approve", a.output_hash);
  await until(r.id, "COMPLETED");
  const artifacts = (
    await pool.query("SELECT * FROM artifacts WHERE run_id=$1", [r.id])
  ).rows;
  assert.equal(artifacts.length, 10);
  for (const f of artifacts) await engine.blobs.read(f.blob_key, f.sha256);
  assert.deepEqual(
    artifacts
      .filter((a) => a.kind.startsWith("report_"))
      .map((a) => a.media_type)
      .sort(),
    ["application/json", "text/csv", "text/markdown"],
  );
  assert.equal((await get(r.id)).spent_cents, 2);
  const attempts = (
    await pool.query(
      "SELECT a.usage FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 AND t.kind='model'",
      [r.id],
    )
  ).rows;
  assert.ok(attempts.every((a) => a.usage.evidence.kind === "HTTP_STUB"));
});
test("invented numeric output and checksum mismatch cannot reach approval or report", async () => {
  const r = await engine.createWorkflow(owner, goal());
  await engine.tick(1);
  const claim = await engine.claimTask();
  const adapter = getProvider(claim!.task.provider_id!);
  const invoke = adapter.invoke;
  adapter.invoke = async (input) => {
    const result = await invoke(input);
    return {
      ...result,
      output: { ...(result.output as object), clicks: 999999 },
    };
  };
  try {
    await engine.executeClaim(claim!);
  } finally {
    adapter.invoke = invoke;
  }
  assert.equal((await get(r.id)).error_code, "INVALID_OUTPUT");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM approvals WHERE run_id=$1",
        [r.id],
      )
    ).rows[0].n,
    0,
  );
  const old = (
    await pool.query("SELECT sha256 FROM seo_datasets WHERE id=$1", [datasetId])
  ).rows[0].sha256;
  const other = await engine.createWorkflow(owner, goal());
  await pool.query("UPDATE seo_datasets SET sha256=$2 WHERE id=$1", [
    datasetId,
    "0".repeat(64),
  ]);
  try {
    await until(other.id, "FAILED");
    assert.equal((await get(other.id)).error_code, "ARTIFACT_CORRUPT");
  } finally {
    await pool.query("UPDATE seo_datasets SET sha256=$2 WHERE id=$1", [
      datasetId,
      old,
    ]);
  }
});
test("expired OAuth state is rejected and a failed revoke blocks reads until retry succeeds", async () => {
  const start = await oauth.begin(owner);
  const state = new URL(start.url).searchParams.get("state")!;
  await pool.query(
    "UPDATE gsc_oauth_states SET expires_at=now()-interval '1 second' WHERE owner_id=$1 AND consumed_at IS NULL",
    [owner],
  );
  await assert.rejects(
    () => oauth.callback(state, start.browser, "fixture-code", signal()),
    /GSC_OAUTH_STATE/,
  );
  gsc.state.revokeStatus = 503;
  try {
    await assert.rejects(
      () => oauth.revoke(owner, signal()),
      /GSC_UNAVAILABLE/,
    );
    assert.equal((await oauth.status(owner)).status, "REVOKE_PENDING");
    await assert.rejects(
      () => oauth.access(owner, signal()),
      /GSC_REVOKE_PENDING/,
    );
  } finally {
    gsc.state.revokeStatus = 200;
  }
  await oauth.revoke(owner, signal());
  assert.equal((await oauth.status(owner)).status, "REVOKED");
  await connect();
});
test("GSC task timeout settles attempt, retries from durable state, and does not mint a dataset early", async () => {
  const r = await beginSync(owner, randomUUID(), testSpec, client);
  await pool.query("UPDATE tasks SET timeout_ms=100 WHERE run_id=$1", [
    r.run_id,
  ]);
  gsc.state.delay = 250;
  await engine.tick(1);
  assert.equal(
    (
      await pool.query("SELECT dataset_id FROM gsc_jobs WHERE id=$1", [
        r.job_id,
      ])
    ).rows[0].dataset_id,
    null,
  );
  const failed = (
    await pool.query(
      "SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1",
      [r.run_id],
    )
  ).rows[0];
  assert.equal(failed.status, "TIMED_OUT");
  gsc.state.delay = 0;
  await pool.query(
    "UPDATE tasks SET timeout_ms=10000,next_attempt_at=now() WHERE run_id=$1",
    [r.run_id],
  );
  await until(r.run_id, "COMPLETED");
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { testDatabase } from "../support";
import { stubCli } from "../cli-support";
import {
  createSubscriptionAdapter,
  subscriptionProviders,
  cliTag,
} from "@orbit/providers/subscription-cli";
import { installRegistry } from "@orbit/core/registry";
import { workspaceHandlers } from "@orbit/workspaces/handlers";
import { integrations } from "@orbit/integrations/registry";
import { GoalInput } from "@orbit/shared/contracts";
import { initializeSubscriptions } from "@orbit/database/subscriptions";
let db: Awaited<ReturnType<typeof testDatabase>>,
  pool: (typeof import("@orbit/database/client"))["pool"],
  engine: typeof import("@orbit/core/engine"),
  owner: string,
  workspace: string,
  dir: string;
before(async () => {
  db = await testDatabase();
  dir = await mkdtemp("/tmp/orbit-cli-integration-");
  process.env.ORBIT_CLI_DIR = dir;
  await import("../../src/server/runtime");
  pool = (await import("@orbit/database/client")).pool;
  engine = await import("@orbit/core/engine");
  const { seed } = await import("../../scripts/seed");
  owner = (await seed()).id;
  workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='research'",
      [owner],
    )
  ).rows[0].id;
  await initializeSubscriptions(owner);
});
after(async () => {
  delete process.env.ORBIT_CLI_DIR;
  delete process.env.ORBIT_LOCAL_MODE;
  delete process.env.ORBIT_OWNER_ID;
  delete process.env.ORBIT_AI_POLICY;
  await pool.end();
  await db.cleanup();
  await rm(dir, { recursive: true, force: true });
});
async function adapters(mode = "normal") {
  const list = [
    createSubscriptionAdapter("codex-cli", stubCli(mode)),
    createSubscriptionAdapter("gemini-cli", stubCli(mode)),
  ];
  for (const p of list) {
    await pool.query(
      "INSERT INTO connections(id,name,mode,status,capabilities,models,metadata) VALUES($1,$1,'MOCK','MOCK',$2,'[\"default\"]','{}') ON CONFLICT DO NOTHING",
      [p.descriptor.id, JSON.stringify(p.descriptor.capabilities)],
    );
    await pool.query(
      "INSERT INTO provider_configs(owner_id,provider_id,enabled,model) VALUES($1,$2,true,'default') ON CONFLICT DO NOTHING",
      [owner, p.descriptor.id],
    );
  }
  installRegistry({
    providers: list,
    handlers: workspaceHandlers,
    integrations,
  });
  return list;
}
const goal = () =>
  GoalInput.parse({
    goal: "Phân tích hồ sơ nghiên cứu và kiểm chứng bằng provider khác",
    workspace_id: workspace,
    request_key: randomUUID(),
    mode: "MOCK",
  });
async function until(run: string, status: string) {
  for (let n = 0; n < 20; n++) {
    await engine.tick(2);
    if (
      (await pool.query("SELECT status FROM runs WHERE id=$1", [run])).rows[0]
        .status === status
    )
      return;
  }
  throw Error("RUN_STATUS_TIMEOUT");
}
test("two real CLI subprocess stubs traverse persistent DAG, structured handoff, hash-bound approval and delivery", async () => {
  await adapters();
  const run = await engine.createWorkflow(owner, goal());
  await until(run.id, "WAITING_APPROVAL");
  const model = (
    await pool.query(
      "SELECT provider_id,output FROM tasks WHERE run_id=$1 AND kind='model' ORDER BY key",
      [run.id],
    )
  ).rows;
  assert.equal(new Set(model.map((r) => r.provider_id)).size, 2);
  const a = (
    await pool.query("SELECT * FROM approvals WHERE run_id=$1", [run.id])
  ).rows[0];
  await assert.rejects(
    () => engine.decideApproval(owner, a.id, "approve", "0".repeat(64)),
    /CONFLICT/,
  );
  await engine.decideApproval(owner, a.id, "approve", a.output_hash);
  await until(run.id, "COMPLETED");
  const usage = (
    await pool.query(
      "SELECT usage FROM attempts WHERE task_id IN(SELECT id FROM tasks WHERE run_id=$1) AND provider_id IS NOT NULL",
      [run.id],
    )
  ).rows;
  assert.ok(usage.every((r) => r.usage.execution === "CLI_STUB"));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
        [run.id],
      )
    ).rows[0].n,
    6,
  );
});
test("quota exhaustion pauses the run without retry/fallback and preserves the completed source checkpoint", async () => {
  await adapters("quota");
  const run = await engine.createWorkflow(owner, goal());
  await until(run.id, "PAUSED");
  const r = (await pool.query("SELECT * FROM runs WHERE id=$1", [run.id]))
    .rows[0];
  assert.equal(r.error_code, "CLI_LIMIT_REACHED");
  const before = (
    await pool.query(
      "SELECT count(*)::int n FROM attempts WHERE task_id IN(SELECT id FROM tasks WHERE run_id=$1)",
      [run.id],
    )
  ).rows[0].n;
  await engine.tick();
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM attempts WHERE task_id IN(SELECT id FROM tasks WHERE run_id=$1)",
        [run.id],
      )
    ).rows[0].n,
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM tasks WHERE run_id=$1 AND key='source'",
        [run.id],
      )
    ).rows[0].status,
    "COMPLETED",
  );
  await engine.controlRun(owner, run.id, "cancel");
});
test("AI planning quota never falls through to template or another provider; manual retries remain bounded", async () => {
  await adapters("quota");
  const run = await engine.createWorkflow(
    owner,
    GoalInput.parse({ ...goal(), planning_strategy: "AI_WITH_FALLBACK" }),
  );
  await until(run.id, "PAUSED");
  const tasks = (
    await pool.query("SELECT key,status FROM tasks WHERE run_id=$1", [run.id])
  ).rows;
  assert.equal(tasks.find((t) => t.key === "interpret").status, "PENDING");
  assert.equal(tasks.find((t) => t.key === "analyze").status, "PENDING");
  await engine.controlRun(owner, run.id, "resume");
  await until(run.id, "PAUSED");
  await engine.controlRun(owner, run.id, "resume");
  await until(run.id, "FAILED");
  assert.equal(
    (
      await pool.query(
        "SELECT attempt_count FROM tasks WHERE run_id=$1 AND key='interpret'",
        [run.id],
      )
    ).rows[0].attempt_count,
    3,
  );
});
test("startup pauses outstanding runs and only the configured local owner can authenticate", async () => {
  await adapters();
  const run = await engine.createWorkflow(owner, goal());
  process.env.ORBIT_LOCAL_MODE = "true";
  process.env.ORBIT_AI_POLICY = "subscription-only";
  process.env.ORBIT_OWNER_ID = owner;
  const { pauseLocalStartup, assertLocalOwner } =
    await import("../../src/server/local-mode");
  assert.ok((await pauseLocalStartup())! >= 1);
  assert.equal(
    (await pool.query("SELECT status FROM runs WHERE id=$1", [run.id])).rows[0]
      .status,
    "PAUSED",
  );
  assert.equal(await engine.claimTask(), null);
  await assertLocalOwner(owner);
  await assert.rejects(() => assertLocalOwner(randomUUID()), /FORBIDDEN/);
  delete process.env.ORBIT_LOCAL_MODE;
  delete process.env.ORBIT_OWNER_ID;
  delete process.env.ORBIT_AI_POLICY;
  await engine.controlRun(owner, run.id, "cancel");
});
test("CLI_STUB and stale receipts cannot admit LIVE subscription workflow", async () => {
  installRegistry({
    providers: subscriptionProviders,
    handlers: workspaceHandlers,
    integrations,
  });
  const { configuredCandidates, configHash } =
    await import("@orbit/core/live-policy");
  for (const p of subscriptionProviders)
    await pool.query(
      "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,capabilities) VALUES($1,$2,'default','CLI_STUB','VERIFIED',$3,$4,$5)",
      [
        owner,
        p.descriptor.id,
        configHash("default", null),
        cliTag(p.descriptor.id),
        JSON.stringify(p.descriptor.capabilities),
      ],
    );
  const c = await pool.connect();
  try {
    assert.ok(
      (await configuredCandidates(c, owner)).every((p) => !p.available),
    );
  } finally {
    c.release();
  }
  await pool.query(
    "UPDATE settings SET data_policy='external' WHERE owner_id=$1",
    [owner],
  );
  await assert.rejects(
    () =>
      engine.createWorkflow(
        owner,
        GoalInput.parse({ ...goal(), mode: "LIVE", live_data_consent: true }),
      ),
    /LIVE_NOT_READY/,
  );
});
test("provider lease serializes processes and releases after errors", async () => {
  const { withCliLease } = await import("@orbit/core/cli-lease");
  let active = 0,
    max = 0;
  const work = () =>
    withCliLease("codex-cli", new AbortController().signal, async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 60));
      active--;
    });
  await Promise.all([work(), work()]);
  assert.equal(max, 1);
  await assert.rejects(() =>
    withCliLease("codex-cli", new AbortController().signal, async () => {
      throw Error("fixture");
    }),
  );
  await work();
});

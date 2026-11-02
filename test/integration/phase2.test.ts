import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../support";
import { stubApi, stubProfile } from "../phase2-support";
import { createLiveAdapter } from "@orbit/providers/live-adapter";
import { wires, liveProviders } from "@orbit/providers/live-registry";
import { providers } from "@orbit/providers/registry";
import { workspaceHandlers } from "@orbit/workspaces/handlers";
import { integrations } from "@orbit/integrations/registry";
import { installRegistry } from "@orbit/core/registry";
import { GoalInput } from "@orbit/shared/contracts";
let environment: Awaited<ReturnType<typeof testDatabase>>,
  stub: Awaited<ReturnType<typeof stubApi>>,
  engine: typeof import("@orbit/core/engine"),
  pool: (typeof import("@orbit/database/client"))["pool"],
  owner: string,
  workspace: string;
before(async () => {
  environment = await testDatabase();
  await import("../../src/server/runtime");
  engine = await import("@orbit/core/engine");
  pool = (await import("@orbit/database/client")).pool;
  owner = (await (await import("../../scripts/seed")).seed()).id;
  workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='research'",
      [owner],
    )
  ).rows[0].id;
  stub = await stubApi();
  const adapters = wires.slice(0, 2).map((wire) => {
    const a = createLiveAdapter(
      wire,
      {
        kind: "HTTP_STUB",
        baseUrl: stub.url + "/" + wire.id,
        fetch: (u, i) => fetch(u, i),
      },
      () => "fixture-api-key",
    );
    a.descriptor.models = ["stub-model"];
    a.descriptor.model = "stub-model";
    a.descriptor.costCents = 4;
    return a;
  });
  installRegistry({
    providers: adapters,
    handlers: workspaceHandlers,
    integrations,
  });
  for (const a of adapters) {
    await pool.query(
      "INSERT INTO connections(id,name,mode,status,capabilities,models,metadata) VALUES($1,$1,'MOCK','MOCK',$2,$3,'{}')",
      [
        a.descriptor.id,
        JSON.stringify(a.descriptor.capabilities),
        JSON.stringify(["stub-model"]),
      ],
    );
    await pool.query(
      "INSERT INTO provider_configs(owner_id,provider_id,enabled,model,model_config) VALUES($1,$2,true,$3,$4)",
      [owner, a.descriptor.id, "stub-model", stubProfile],
    );
  }
});
after(async () => {
  await stub?.close();
  await pool?.end();
  await environment?.cleanup();
});
const goal = (extra = {}) =>
  GoalInput.parse({
    goal: "Prepare a research report with evidence and a verified task plan",
    workspace_id: workspace,
    request_key: randomUUID(),
    budget_cents: 100,
    planning_strategy: "AI_WITH_FALLBACK",
    ...extra,
  });
const get = async (id: string) =>
  (await pool.query("SELECT * FROM runs WHERE id=$1", [id])).rows[0];
async function until(id: string, status: string) {
  for (let i = 0; i < 45; i++) {
    if ((await get(id)).status === status) return;
    await engine.tick(2);
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal((await get(id)).status, status);
}
test("two real protocol adapters hand structured data across durable worker tasks, always labeled HTTP_STUB/MOCK", async () => {
  const r = await engine.createWorkflow(owner, goal());
  await until(r.id, "WAITING_APPROVAL");
  const tasks = (
    await pool.query("SELECT * FROM tasks WHERE run_id=$1", [r.id])
  ).rows;
  assert.equal(tasks.length, 7);
  assert.equal(tasks.find((t) => t.key === "interpret").output.strategy, "AI");
  assert.notEqual(
    tasks.find((t) => t.key === "analyze").provider_id,
    tasks.find((t) => t.key === "review").provider_id,
  );
  const a = (
    await pool.query("SELECT * FROM approvals WHERE run_id=$1", [r.id])
  ).rows[0];
  await engine.decideApproval(owner, a.id, "approve", a.output_hash);
  await until(r.id, "COMPLETED");
  const attempts = (
    await pool.query(
      "SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 AND t.kind=$2",
      [r.id, "model"],
    )
  ).rows;
  assert.ok(attempts.every((a) => a.usage.evidence.kind === "HTTP_STUB"));
  assert.equal((await get(r.id)).mode, "MOCK");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM connections WHERE status='CONNECTED'",
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    stub.requests.some(
      (r) =>
        JSON.stringify(r.body).includes("Independent review") ||
        JSON.stringify(r.body).includes("HTTP_STUB"),
    ),
  );
});
test("unsafe AI planning falls back and cannot remove approval or enable writes", async () => {
  stub.behavior.invalidPlan = true;
  try {
    const r = await engine.createWorkflow(owner, goal());
    await until(r.id, "WAITING_APPROVAL");
    const plan = (
      await pool.query(
        "SELECT output FROM tasks WHERE run_id=$1 AND key='interpret'",
        [r.id],
      )
    ).rows[0].output;
    assert.equal(plan.strategy, "TEMPLATE_FALLBACK");
    assert.ok(plan.fallback_reason);
    assert.ok(
      plan.plan.steps.some((s: { key: string }) => s.key === "approve"),
    );
    await engine.controlRun(owner, r.id, "cancel");
  } finally {
    stub.behavior.invalidPlan = false;
  }
});
test("uncertain billable errors consume reservation and budget halts retries", async () => {
  stub.behavior.status = 503;
  try {
    const r = await engine.createWorkflow(
      owner,
      goal({ planning_strategy: "TEMPLATE", budget_cents: 8 }),
    );
    await until(r.id, "FAILED");
    const row = await get(r.id);
    assert.equal(row.spent_cents, 8);
    assert.equal(row.reserved_cents, 0);
    assert.equal(row.error_code, "BUDGET_EXCEEDED");
    const attempts = (
      await pool.query(
        "SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 AND t.key='analyze'",
        [r.id],
      )
    ).rows;
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((a) => a.cost_cents === 4));
    await engine.controlRun(owner, r.id, "cancel");
  } finally {
    stub.behavior.status = 200;
  }
});
test("LIVE admission rejects HTTP stub providers even after successful protocol tests", async () => {
  await pool.query(
    "UPDATE settings SET data_policy='external' WHERE owner_id=$1",
    [owner],
  );
  await assert.rejects(
    () =>
      engine.createWorkflow(
        owner,
        goal({ mode: "LIVE", live_data_consent: true }),
      ),
    (e) => e instanceof Error && e.message === "LIVE_NOT_READY",
  );
  await pool.query(
    "UPDATE settings SET data_policy='local-only' WHERE owner_id=$1",
    [owner],
  );
});
test("a changed operator price after claim cannot change an in-flight reservation snapshot", async () => {
  const r = await engine.createWorkflow(
    owner,
    goal({ planning_strategy: "TEMPLATE" }),
  );
  await engine.tick(1);
  const claim = await engine.claimTask();
  assert.equal(claim?.task.key, "analyze");
  try {
    await pool.query(
      "UPDATE provider_configs SET model_config=$3 WHERE owner_id=$1 AND provider_id=$2",
      [
        owner,
        claim!.task.provider_id,
        { ...stubProfile, input_usd_per_million: 1000 },
      ],
    );
    await engine.executeClaim(claim!);
    const attempt = (
      await pool.query("SELECT * FROM attempts WHERE id=$1", [
        claim!.attempt.id,
      ])
    ).rows[0];
    assert.equal(attempt.cost_cents, 1);
    assert.equal(
      attempt.provider_snapshot.profile.input_usd_per_million,
      stubProfile.input_usd_per_million,
    );
    assert.equal((await get(r.id)).reserved_cents, 0);
  } finally {
    await pool.query(
      "UPDATE provider_configs SET model_config=$3 WHERE owner_id=$1 AND provider_id=$2",
      [owner, claim!.task.provider_id, stubProfile],
    );
    await engine.controlRun(owner, r.id, "cancel");
  }
});
test("cancel discards in-flight output while preserving reported HTTP_STUB usage and cost", async () => {
  const r = await engine.createWorkflow(
    owner,
    goal({ planning_strategy: "TEMPLATE" }),
  );
  await engine.tick(1);
  const claim = await engine.claimTask();
  stub.behavior.delay = 150;
  const count = stub.requests.length;
  const running = engine.executeClaim(claim!);
  try {
    for (let i = 0; i < 30 && stub.requests.length === count; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(stub.requests.length > count);
    await engine.controlRun(owner, r.id, "cancel");
    await running;
    const row = await get(r.id);
    assert.equal(row.status, "CANCELED");
    assert.equal(row.spent_cents, 1);
    assert.equal(row.reserved_cents, 0);
    const attempt = (
      await pool.query("SELECT * FROM attempts WHERE id=$1", [
        claim!.attempt.id,
      ])
    ).rows[0];
    assert.equal(attempt.status, "CANCELED");
    assert.equal(attempt.usage.evidence.kind, "HTTP_STUB");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
          [r.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    stub.behavior.delay = 0;
    await running;
  }
});
test("review with a wrong source checksum cannot create a task board or approval", async () => {
  stub.behavior.wrongReviewHash = true;
  try {
    const r = await engine.createWorkflow(
      owner,
      goal({ planning_strategy: "TEMPLATE" }),
    );
    await until(r.id, "FAILED");
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
    await engine.controlRun(owner, r.id, "cancel");
  } finally {
    stub.behavior.wrongReviewHash = false;
  }
});
test("HTTP 429 retries at engine boundary with backoff, without charging a rejected request", async () => {
  const r = await engine.createWorkflow(
    owner,
    goal({ planning_strategy: "TEMPLATE" }),
  );
  await engine.tick(1);
  const claim = await engine.claimTask();
  stub.behavior.status = 429;
  try {
    await engine.executeClaim(claim!);
  } finally {
    stub.behavior.status = 200;
  }
  const attempt = (
    await pool.query("SELECT * FROM attempts WHERE id=$1", [claim!.attempt.id])
  ).rows[0];
  assert.equal(attempt.error_code, "RATE_LIMIT");
  assert.equal(attempt.cost_cents, 0);
  assert.equal((await get(r.id)).reserved_cents, 0);
  await until(r.id, "WAITING_APPROVAL");
  assert.equal(
    (
      await pool.query("SELECT attempt_count FROM tasks WHERE id=$1", [
        claim!.task.id,
      ])
    ).rows[0].attempt_count,
    2,
  );
  await engine.controlRun(owner, r.id, "cancel");
});
test("a synthetic HTTP_STUB probe receipt cannot activate a credential-present LIVE adapter", async () => {
  const { credentialFingerprint } = await import("@orbit/providers/transport");
  const { configuredCandidates, configHash } =
    await import("@orbit/core/live-policy");
  const previous = process.env.ORBIT_OPENAI_API_KEY;
  process.env.ORBIT_OPENAI_API_KEY = "http-stub-fixture-not-a-real-credential";
  installRegistry({
    providers: liveProviders,
    handlers: workspaceHandlers,
    integrations,
  });
  try {
    await pool.query(
      "INSERT INTO provider_configs(owner_id,provider_id,model,enabled,model_config) VALUES($1,'openai','stub-model',true,$2) ON CONFLICT(owner_id,provider_id) DO UPDATE SET model=excluded.model,enabled=true,model_config=excluded.model_config",
      [owner, stubProfile],
    );
    await pool.query(
      "INSERT INTO provider_probes(owner_id,provider_id,model,kind,status,config_hash,credential_tag,capabilities,finished_at) VALUES($1,'openai','stub-model','HTTP_STUB','VERIFIED',$2,$3,$4,now())",
      [
        owner,
        configHash("stub-model", stubProfile),
        credentialFingerprint("openai"),
        JSON.stringify(["analysis", "review", "planning"]),
      ],
    );
    const client = await pool.connect();
    try {
      assert.equal(
        (await configuredCandidates(client, owner)).find(
          (c) => c.id === "openai",
        )?.available,
        false,
      );
    } finally {
      client.release();
    }
  } finally {
    if (previous === undefined) delete process.env.ORBIT_OPENAI_API_KEY;
    else process.env.ORBIT_OPENAI_API_KEY = previous;
    installRegistry({
      providers: [...providers, ...liveProviders],
      handlers: workspaceHandlers,
      integrations,
    });
  }
});

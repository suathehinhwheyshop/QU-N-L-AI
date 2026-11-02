import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../support";
import { GoalInput, type Plan } from "../../src/core/contracts";
let cleanup: Awaited<ReturnType<typeof testDatabase>>,
  engine: typeof import("../../src/core/engine"),
  pool: (typeof import("../../src/db/client"))["pool"],
  owner: string,
  workspace: string;
before(async () => {
  cleanup = await testDatabase();
  await import("../../src/server/runtime");
  engine = await import("../../src/core/engine");
  pool = (await import("../../src/db/client")).pool;
  owner = (await (await import("../../scripts/seed")).seed()).id;
  workspace = (
    await pool.query(
      "SELECT id FROM workspaces WHERE kind='seo' AND owner_id=$1",
      [owner],
    )
  ).rows[0].id;
});
after(async () => {
  await pool?.end();
  await cleanup?.cleanup();
});
const input = (extra = {}) =>
  GoalInput.parse({
    goal: "Phân tích SEO WheyShop và lập bảng việc tối ưu",
    workspace_id: workspace,
    request_key: randomUUID(),
    ...extra,
  });
async function row(id: string) {
  return (await pool.query("SELECT * FROM runs WHERE id=$1", [id])).rows[0];
}
async function until(id: string, status: string) {
  for (let i = 0; i < 35; i++) {
    if ((await row(id)).status === status) return;
    await engine.tick(4);
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal((await row(id)).status, status);
}
async function gate(id: string) {
  return (await pool.query("SELECT * FROM approvals WHERE run_id=$1", [id]))
    .rows[0];
}
async function cancel(id: string) {
  const r = await row(id);
  if (!["CANCELED", "COMPLETED"].includes(r.status))
    await engine.controlRun(owner, id, "cancel");
}
test("PostgreSQL workflow: idempotency, two providers, hash-bound approval and verified artifacts", async () => {
  const goal = input();
  const [a, b] = await Promise.all([
    engine.createWorkflow(owner, goal),
    engine.createWorkflow(owner, goal),
  ]);
  assert.equal(a.id, b.id);
  await assert.rejects(() =>
    engine.createWorkflow(owner, {
      ...goal,
      goal: "Một mục tiêu khác nhưng cố dùng lại request key",
    }),
  );
  await until(a.id, "WAITING_APPROVAL");
  const tasks = (
    await pool.query("SELECT * FROM tasks WHERE run_id=$1", [a.id])
  ).rows;
  assert.notEqual(
    tasks.find((t) => t.key === "analyze").provider_id,
    tasks.find((t) => t.key === "review").provider_id,
  );
  const approval = await gate(a.id);
  await assert.rejects(() =>
    engine.decideApproval(owner, approval.id, "approve", "0".repeat(64)),
  );
  await assert.rejects(() =>
    engine.decideApproval(
      randomUUID(),
      approval.id,
      "approve",
      approval.output_hash,
    ),
  );
  await engine.decideApproval(
    owner,
    approval.id,
    "approve",
    approval.output_hash,
  );
  await until(a.id, "COMPLETED");
  const artifacts = (
    await pool.query("SELECT * FROM artifacts WHERE run_id=$1", [a.id])
  ).rows;
  assert.equal(artifacts.length, 6);
  for (const file of artifacts)
    await engine.blobs.read(file.blob_key, file.sha256);
  assert.equal((await row(a.id)).spent_cents, 0);
  await assert.rejects(() =>
    engine.decideApproval(owner, approval.id, "approve", approval.output_hash),
  );
});
test("paused and canceled runs never start downstream tasks; inflight result discarded", async () => {
  const r = await engine.createWorkflow(owner, input());
  await engine.controlRun(owner, r.id, "pause");
  assert.equal(await engine.claimTask(), null);
  await engine.controlRun(owner, r.id, "resume");
  const claim = await engine.claimTask();
  assert.equal(claim?.run.id, r.id);
  await engine.controlRun(owner, r.id, "cancel");
  await engine.executeClaim(claim!);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM artifacts WHERE run_id=$1",
        [r.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await row(r.id)).status, "CANCELED");
});
test("expired lease recovers checkpoint and fences late completion", async () => {
  const r = await engine.createWorkflow(owner, input());
  const old = await engine.claimTask();
  assert.equal(old?.run.id, r.id);
  await pool.query(
    "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
    [old!.task.id],
  );
  await engine.recoverExpired();
  await pool.query("UPDATE tasks SET next_attempt_at=now() WHERE id=$1", [
    old!.task.id,
  ]);
  const fresh = await engine.claimTask();
  assert.equal(fresh?.attempt.number, 2);
  await engine.executeClaim(fresh!);
  await engine.executeClaim(old!);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM artifacts WHERE task_id=$1",
        [old!.task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM attempts WHERE id=$1", [
        old!.attempt.id,
      ])
    ).rows[0].status,
    "FAILED",
  );
  await cancel(r.id);
});
test("parallel runnable tasks respect owner concurrency; competing claim cannot duplicate attempt", async () => {
  const g = input();
  const plan = await engine.previewGoal(owner, g);
  plan.nodes = [
    plan.nodes[0],
    { ...plan.nodes[1], key: "analyze_a" },
    { ...plan.nodes[1], key: "analyze_b" },
  ];
  const r = await engine.createFromPlan(owner, g, plan);
  const initial = await Promise.all([engine.claimTask(), engine.claimTask()]);
  assert.equal(initial.filter(Boolean).length, 1);
  await engine.executeClaim(initial.find(Boolean)!);
  const claims = (
    await Promise.all([
      engine.claimTask(),
      engine.claimTask(),
      engine.claimTask(),
    ])
  ).filter((x) => x !== null);
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].task.id, claims[1].task.id);
  await Promise.all(claims.map(engine.executeClaim));
  assert.equal((await row(r.id)).status, "COMPLETED");
});
test("timeout aborts adapter and exhausts bounded retry with backoff", async () => {
  const r = await engine.createWorkflow(owner, input({ scenario: "timeout" }));
  await pool.query(
    "UPDATE tasks SET timeout_ms=100,max_attempts=2 WHERE run_id=$1 AND kind='model'",
    [r.id],
  );
  await until(r.id, "FAILED");
  const attempts = (
    await pool.query(
      "SELECT a.* FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 AND t.key='analyze'",
      [r.id],
    )
  ).rows;
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((a) => a.status === "TIMED_OUT"));
  assert.equal(await engine.claimTask(), null);
  await assert.rejects(() => engine.controlRun(owner, r.id, "retry"));
  await cancel(r.id);
});
test("invalid structured output never reaches review or report", async () => {
  const r = await engine.createWorkflow(
    owner,
    input({ scenario: "invalid-output" }),
  );
  await until(r.id, "FAILED");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM artifacts WHERE run_id=$1",
        [r.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await row(r.id)).error_code, "INVALID_OUTPUT");
  await cancel(r.id);
});
test("budget reservations are atomic across parallel tasks", async () => {
  const adapters = (await import("../../src/providers/registry")).providers;
  const previous = adapters.map((p) => p.descriptor.costCents);
  try {
    adapters.forEach((p) => (p.descriptor.costCents = 2));
    const g = input({ budget_cents: 3 }),
      plan = await engine.previewGoal(owner, g);
    plan.nodes = [
      plan.nodes[0],
      { ...plan.nodes[1], key: "a" },
      { ...plan.nodes[1], key: "b" },
    ];
    const r = await engine.createFromPlan(owner, g, plan);
    await engine.tick(1);
    const one = await engine.claimTask();
    assert.equal((await row(r.id)).reserved_cents, 2);
    assert.equal(await engine.claimTask(), null);
    assert.equal((await row(r.id)).error_code, "BUDGET_EXCEEDED");
    await engine.executeClaim(one!);
    assert.equal((await row(r.id)).reserved_cents, 0);
    await cancel(r.id);
  } finally {
    adapters.forEach((p, i) => (p.descriptor.costCents = previous[i]));
  }
});
test("rejected approval prevents delivery; tampered source blocks validation", async () => {
  const r = await engine.createWorkflow(owner, input());
  await until(r.id, "WAITING_APPROVAL");
  const a = await gate(r.id);
  await engine.decideApproval(owner, a.id, "reject", a.output_hash);
  assert.equal((await row(r.id)).status, "CANCELED");
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM tasks WHERE run_id=$1 AND key='deliver'",
        [r.id],
      )
    ).rows[0].status,
    "CANCELED",
  );
  const r2 = await engine.createWorkflow(owner, input());
  await engine.tick(1);
  await pool.query("UPDATE artifacts SET sha256=$2 WHERE run_id=$1", [
    r2.id,
    "0".repeat(64),
  ]);
  await until(r2.id, "FAILED");
  assert.equal((await row(r2.id)).error_code, "ARTIFACT_CORRUPT");
  await cancel(r2.id);
});

test("each non-SEO workspace runs on the same durable engine without SEO fixtures", async () => {
  for (const [kind, prefix] of [
    ["video", "VIDEO-"],
    ["research", "RESEARCH-"],
    ["development", "DEV-"],
  ]) {
    const workspaceId = (
      await pool.query(
        "SELECT id FROM workspaces WHERE owner_id=$1 AND kind=$2",
        [owner, kind],
      )
    ).rows[0].id;
    const g = input({
      workspace_id: workspaceId,
      goal: "Lập kế hoạch " + kind + " có nguồn và tiêu chí bàn giao",
      acceptance_criteria: ["Có bằng chứng cho mọi kết luận."],
    });
    const r = await engine.createWorkflow(owner, g);
    await until(r.id, "WAITING_APPROVAL");
    const current = await row(r.id);
    assert.equal(current.plan.interpretation.workspace, kind);
    assert.ok(
      current.plan.interpretation.acceptance_criteria.includes(
        g.acceptance_criteria[0],
      ),
    );
    const board = (
      await pool.query(
        "SELECT output FROM tasks WHERE run_id=$1 AND key='board'",
        [r.id],
      )
    ).rows[0].output;
    assert.ok(
      board.items.every((item: { id: string }) => item.id.startsWith(prefix)),
    );
    assert.doesNotMatch(JSON.stringify(board), /CTR|whey-isolate/i);
    const a = await gate(r.id);
    await engine.decideApproval(owner, a.id, "approve", a.output_hash);
    await until(r.id, "COMPLETED");
  }
});

test("owner-specific provider configuration changes actual routing and can block all unavailable adapters", async () => {
  try {
    await pool.query(
      "UPDATE provider_configs SET enabled=false WHERE owner_id=$1 AND provider_id='mock-anthropic'",
      [owner],
    );
    const r = await engine.createWorkflow(owner, input());
    await until(r.id, "WAITING_APPROVAL");
    const analyst = (
      await pool.query(
        "SELECT provider_id FROM tasks WHERE run_id=$1 AND key='analyze'",
        [r.id],
      )
    ).rows[0];
    assert.notEqual(analyst.provider_id, "mock-anthropic");
    await cancel(r.id);
    await pool.query(
      "UPDATE provider_configs SET enabled=false WHERE owner_id=$1",
      [owner],
    );
    const unavailable = await engine.createWorkflow(owner, input());
    await until(unavailable.id, "FAILED");
    assert.equal((await row(unavailable.id)).error_code, "NO_PROVIDER");
    await cancel(unavailable.id);
  } finally {
    await pool.query(
      "UPDATE provider_configs SET enabled=true WHERE owner_id=$1",
      [owner],
    );
  }
});

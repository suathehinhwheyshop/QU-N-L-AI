import "../../src/server/runtime";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GoalInput, Analysis, Review } from "../../src/core/contracts";
import { planGoal, validateGraph } from "../../src/core/planner";
import { routeModel } from "../../src/core/router";
import { providers } from "../../src/providers/registry";
import { digest, jsonBytes, LocalArtifactStore } from "../../src/storage/store";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const goal = () =>
  GoalInput.parse({
    goal: "Phân tích GSC và tạo kế hoạch SEO",
    workspace_id: randomUUID(),
    request_key: randomUUID(),
  });
test("planner produces a bounded read-only DAG with independent review and approval", () => {
  const p = planGoal(goal(), "seo");
  assert.equal(p.nodes.length, 6);
  assert.equal(p.nodes[2].input.avoid_provider_task, "analyze");
  assert.ok(p.nodes.every((n) => n.effect === "read"));
  assert.equal(p.nodes.find((n) => n.kind === "approval")?.key, "approve");
  assert.equal(p.estimate.cost_cents, 0);
});
test("graph rejects cycles, missing/duplicate dependencies and external writes", () => {
  const nodes = planGoal(goal(), "seo").nodes;
  assert.throws(() => validateGraph([{ ...nodes[0], depends_on: ["source"] }]));
  assert.throws(() =>
    validateGraph([{ ...nodes[0], depends_on: ["missing"] }]),
  );
  assert.throws(() => validateGraph([nodes[0], nodes[0]]));
  assert.throws(() => validateGraph([{ ...nodes[0], effect: "write" }]));
  assert.throws(() =>
    validateGraph(
      Array.from({ length: 33 }, (_, i) => ({ ...nodes[0], key: "node" + i })),
    ),
  );
});
test("live planning is blocked without real adapters; workspace core is reusable", () => {
  assert.throws(() => planGoal({ ...goal(), mode: "LIVE" }, "seo"));
  for (const kind of ["research", "video", "development"]) {
    const p = planGoal(goal(), kind);
    assert.equal(p.nodes[0].handler, kind + ".source");
    assert.equal(p.nodes[0].input.workspace, kind);
  }
});
test("router filters capability, data policy, availability and budget; review avoids analyst", () => {
  const all = providers.map((p) => p.descriptor);
  const a = routeModel(all, "analysis", "MOCK", "local-only", 0),
    b = routeModel(all, "review", "MOCK", "local-only", 0, a.id);
  assert.notEqual(a.id, b.id);
  assert.throws(() => routeModel(all, "image", "MOCK", "local-only", 0));
  assert.throws(() =>
    routeModel(
      [{ ...all[0], costCents: 2 }],
      "analysis",
      "MOCK",
      "local-only",
      1,
    ),
  );
  assert.throws(() =>
    routeModel(
      [{ ...all[0], dataPolicy: "external" }],
      "analysis",
      "MOCK",
      "local-only",
      5,
    ),
  );
  assert.throws(() =>
    routeModel(
      [{ ...all[0], available: false }],
      "analysis",
      "MOCK",
      "local-only",
      5,
    ),
  );
});
test("mock output validates structured handoff, reports zero cost and never Connected", async () => {
  const p = providers[0],
    data = {
      source: { site: "https://wheyshop.vn" },
      source_sha256: "a".repeat(64),
    };
  const r = await p.invoke({
    capability: "analysis",
    data,
    attempt: 1,
    scenario: "normal",
    signal: new AbortController().signal,
  });
  const a = Analysis.parse(r.output);
  const review = await providers[1].invoke({
    capability: "review",
    data: { ...data, analysis: a },
    attempt: 1,
    scenario: "normal",
    signal: new AbortController().signal,
  });
  assert.equal(Review.parse(review.output).reviewed, true);
  assert.equal(r.costCents, 0);
  assert.equal((await p.health()).status, "MOCK");
  assert.throws(() => Analysis.parse({ summary: "incomplete" }));
});
test("canonical checksums survive jsonb object key order; artifact bytes verified", async () => {
  assert.equal(
    digest(jsonBytes({ z: 1, a: { b: 2, a: 1 } })),
    digest(jsonBytes({ a: { a: 1, b: 2 }, z: 1 })),
  );
  const root = await mkdtemp(join(tmpdir(), "orbit-unit-"));
  try {
    const store = new LocalArtifactStore(root),
      bytes = Buffer.from("artifact evidence"),
      s = await store.put(bytes);
    assert.deepEqual(await store.read(s.key, s.sha256), bytes);
    assert.equal((await store.put(bytes)).key, s.key);
    await assert.rejects(() => store.read("../private", "bad"));
    await assert.rejects(() => store.read(s.key, "0".repeat(64)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integration contract exposes only fixture read scope and validates connector input/output", async () => {
  const { integrations } = await import("../../src/integrations/registry");
  const adapter = integrations[0];
  assert.deepEqual(adapter.scopes, ["fixture.read"]);
  assert.equal((await adapter.health()).status, "MOCK");
  const data = await adapter.execute(
    { site: "https://wheyshop.vn" },
    new AbortController().signal,
  );
  assert.equal((data as { source: string }).source, "MOCK");
  await assert.rejects(() =>
    adapter.execute({ site: "not a URL" }, new AbortController().signal),
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() =>
    adapter.execute({ site: "https://wheyshop.vn" }, aborted.signal),
  );
});

test("concurrent artifact publication never exposes partial bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbit-atomic-"));
  try {
    const store = new LocalArtifactStore(root);
    const bytes = Buffer.alloc(250000, "x");
    const copies = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const result = await store.put(bytes);
        assert.deepEqual(await store.read(result.key, result.sha256), bytes);
        return result.key;
      }),
    );
    assert.equal(new Set(copies).size, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval requires exactly one canonical manifest dependency", () => {
  const nodes = planGoal(goal(), "seo").nodes;
  const gate = nodes.find((n) => n.kind === "approval")!;
  assert.throws(() => validateGraph([{ ...gate, depends_on: [] }]));
  assert.throws(() =>
    validateGraph([
      nodes[0],
      nodes[1],
      { ...gate, depends_on: ["source", "analyze"] },
    ]),
  );
});

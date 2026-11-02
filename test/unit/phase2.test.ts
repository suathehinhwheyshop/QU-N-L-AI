import { test } from "node:test";
import assert from "node:assert/strict";
import { wires } from "@orbit/providers/live-registry";
import { createLiveAdapter } from "@orbit/providers/live-adapter";
import { reserveCost, ApiFailure } from "@orbit/providers/transport";
import { Analysis, OrbitError } from "@orbit/shared/contracts";
import { stubApi, stubProfile } from "../phase2-support";
import { templateAIPlan, validateAIPlan } from "@orbit/workspaces/ai-planning";
test("four vendor protocols execute through HTTP_STUB without LIVE evidence or hidden retries", async () => {
  const stub = await stubApi();
  try {
    for (const wire of wires) {
      const adapter = createLiveAdapter(
        wire,
        {
          kind: "HTTP_STUB",
          baseUrl: stub.url + "/" + wire.id,
          fetch: (url, init) => fetch(url, init),
        },
        () => "fixture-api-key",
      );
      const result = await adapter.invoke({
        capability: "analysis",
        data: {
          source_sha256: "a".repeat(64),
          source: { site: "https://example.org" },
        },
        model: "stub-model",
        profile: stubProfile,
        attempt: 1,
        scenario: "normal",
        signal: new AbortController().signal,
      });
      Analysis.parse(result.output);
      assert.equal(adapter.descriptor.mode, "MOCK");
      assert.equal(result.evidence?.kind, "HTTP_STUB");
      assert.equal(result.usage.input_tokens, 20);
      assert.equal(result.costCents, 1);
      const req = stub.requests.at(-1)!;
      assert.match(
        req.path,
        wire.id === "google"
          ? /generateContent$/
          : wire.id === "anthropic"
            ? /v1\/messages$/
            : /v1\/chat\/completions$/,
      );
      assert.equal(
        wire.id === "anthropic"
          ? req.headers["x-api-key"]
          : wire.id === "google"
            ? req.headers["x-goog-api-key"]
            : req.headers.authorization,
        wire.id === "anthropic" || wire.id === "google"
          ? "fixture-api-key"
          : "Bearer fixture-api-key",
      );
    }
    assert.equal(stub.requests.length, 4);
  } finally {
    await stub.close();
  }
});
test("transport sanitizes errors, charges uncertainty and redacts response echoes", async () => {
  const stub = await stubApi();
  try {
    const adapter = createLiveAdapter(
      wires[0],
      {
        kind: "HTTP_STUB",
        baseUrl: stub.url + "/openai",
        fetch: (u, i) => fetch(u, i),
      },
      () => "fixture-api-key",
    );
    const input = {
      capability: "analysis",
      data: { source_sha256: "a".repeat(64) },
      model: "stub-model",
      profile: stubProfile,
      attempt: 1,
      scenario: "normal",
      signal: new AbortController().signal,
    };
    stub.behavior.status = 401;
    await assert.rejects(
      () => adapter.invoke(input),
      (e) =>
        e instanceof OrbitError &&
        e.code === "AUTH_FAILED" &&
        !e.retryable &&
        !String(e).includes("fixture-api-key"),
    );
    assert.equal(stub.requests.length, 1);
    stub.behavior.status = 503;
    await assert.rejects(
      () => adapter.invoke(input),
      (e) => e instanceof OrbitError && e.billingUncertain,
    );
    stub.behavior.status = 200;
    stub.behavior.invalidJson = true;
    await assert.rejects(
      () => adapter.invoke(input),
      (e) => e instanceof OrbitError && e.billingUncertain,
    );
    stub.behavior.invalidJson = false;
    stub.behavior.echoKey = true;
    const r = await adapter.invoke(input);
    assert.ok(!JSON.stringify(r).includes("fixture-api-key"));
    stub.behavior.delay = 100;
    await assert.rejects(
      () => adapter.invoke({ ...input, signal: AbortSignal.timeout(10) }),
      (e) =>
        e instanceof OrbitError && e.code === "TIMEOUT" && e.billingUncertain,
    );
  } finally {
    await stub.close();
  }
});
test("input cap is enforced before any network call and pricing quote is conservative", () => {
  assert.throws(
    () => reserveCost({ text: "x".repeat(40000) }, {}, stubProfile),
    (e) => e instanceof OrbitError && e.code === "CONTEXT_LIMIT",
  );
  assert.ok(reserveCost({ text: "short" }, {}, stubProfile) >= 1);
});
test("AI plan schema preserves goal, read-only steps, dependencies and human approval", () => {
  const objective = "Prepare a verified plan for the supplied objective";
  const valid = templateAIPlan(objective, ["Evidence required"]);
  assert.equal(validateAIPlan(valid, objective).steps.length, 5);
  assert.throws(() =>
    validateAIPlan(valid, objective, [
      "A mandatory criterion that was removed",
    ]),
  );
  const combined = Array.from(
    { length: 14 },
    (_, i) => "User and workspace acceptance " + i,
  );
  assert.equal(
    validateAIPlan(templateAIPlan(objective, combined), objective, combined)
      .acceptance_criteria.length,
    14,
  );
  assert.throws(() =>
    validateAIPlan({ ...valid, objective: "A different objective" }, objective),
  );
  assert.throws(() =>
    validateAIPlan(
      { ...valid, steps: valid.steps.filter((s) => s.key !== "approve") },
      objective,
    ),
  );
  assert.throws(() =>
    validateAIPlan(
      {
        ...valid,
        steps: valid.steps.map((s) =>
          s.key === "analyze" ? { ...s, effect: "write" } : s,
        ),
      },
      objective,
    ),
  );
  assert.throws(() =>
    validateAIPlan(
      {
        ...valid,
        steps: valid.steps.map((s) =>
          s.key === "deliver" ? { ...s, depends_on: ["board"] } : s,
        ),
      },
      objective,
    ),
  );
});
test("router weighs price and measured latency after filtering unavailable capabilities", async () => {
  const { routeModel } = await import("@orbit/core/router");
  const base = {
    ...createLiveAdapter(wires[0]).descriptor,
    available: true,
    costCents: 2,
    latencyMs: 50,
  };
  const select = (values: (typeof base)[]) =>
    routeModel(values, "analysis", "LIVE", "external", 20).id;
  assert.equal(
    select([
      { ...base, id: "fast", latencyMs: 50 },
      { ...base, id: "slow", latencyMs: 5000 },
    ]),
    "fast",
  );
  assert.equal(
    select([
      { ...base, id: "cheap", costCents: 1 },
      { ...base, id: "expensive", costCents: 10 },
    ]),
    "cheap",
  );
  assert.equal(
    select([
      { ...base, id: "down", costCents: 0, available: false },
      { ...base, id: "ready" },
    ]),
    "ready",
  );
  assert.throws(
    () => select([{ ...base, capabilities: ["image"] }]),
    /NO_PROVIDER/,
  );
});

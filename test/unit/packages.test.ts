import "../../src/server/runtime";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { GoalInput, Analysis } from "@orbit/shared/contracts";
import { interpretGoal } from "@orbit/core/interpreter";
import { planGoal } from "@orbit/core/planner";
import { workspaceModules } from "@orbit/workspaces/registry";
import {
  providers,
  definitions,
  describeLiveProvider,
} from "@orbit/providers/registry";
const goal = () =>
  GoalInput.parse({
    goal: "Chuẩn bị kế hoạch theo yêu cầu của người dùng",
    workspace_id: randomUUID(),
    request_key: randomUUID(),
    acceptance_criteria: ["Mỗi đầu ra có nguồn và hạn chế rõ ràng."],
  });
test("Goal Interpreter preserves objective, user acceptance and read-only constraints", () => {
  const g = goal();
  const contract = interpretGoal(g, "research");
  assert.equal(contract.objective, g.goal);
  assert.ok(contract.acceptance_criteria.includes(g.acceptance_criteria[0]));
  assert.equal(contract.constraints.external_calls, false);
  assert.equal(contract.strategy, "TEMPLATE");
  assert.throws(() => interpretGoal(g, "not-registered"));
});
test("four workspace modules produce distinct plans and domain-specific mock fixtures", () => {
  assert.equal(workspaceModules.length, 4);
  const templates = new Set<string>();
  for (const module of workspaceModules) {
    const g = goal(),
      plan = planGoal(g, module.kind);
    templates.add(plan.template);
    assert.equal(plan.nodes[0].handler, module.sourceHandler);
    const fixture = Analysis.parse(
      module.fixture({
        goal: g.goal,
        site: g.site,
        source_sha256: "f".repeat(64),
      }),
    );
    assert.ok(fixture.summary.includes(g.goal));
    if (module.kind !== "seo") {
      assert.ok(fixture.findings.every((i) => !i.id.startsWith("SEO")));
      assert.doesNotMatch(JSON.stringify(fixture), /CTR|whey-isolate/i);
    }
    assert.equal(
      (plan.nodes[1].input.goal_contract as { workspace: string }).workspace,
      module.kind,
    );
  }
  assert.equal(templates.size, 4);
});
test("four independent vendor mock adapters have explicit capabilities/models and never Connected", async () => {
  assert.deepEqual(
    definitions.map((d) => d.id),
    ["anthropic", "openai", "google", "xai"],
  );
  assert.equal(new Set(providers.map((p) => p.descriptor.model)).size, 4);
  for (const adapter of providers) {
    assert.equal(adapter.descriptor.mode, "MOCK");
    assert.ok(adapter.descriptor.models?.includes(adapter.descriptor.model));
    assert.equal((await adapter.health()).status, "MOCK");
    const live = describeLiveProvider(adapter.descriptor.vendor!);
    assert.equal(live.status, "DISCONNECTED");
    assert.equal(live.implementation, "CODE_READY_UNVERIFIED");
  }
});
test("core package has no imports of concrete providers, integrations or workspace business logic", async () => {
  for (const name of await readdir("packages/core/src")) {
    if (!name.endsWith(".ts")) continue;
    const text = await readFile("packages/core/src/" + name, "utf8");
    assert.doesNotMatch(
      text,
      /(?:from|import\()\s*["']@orbit\/(?:providers|workspaces|integrations)/,
    );
    assert.doesNotMatch(text, /wheyshop|grokbot|whey-isolate/i);
  }
});
test("frontend does not import database or credential code at runtime", async () => {
  const ui = await readFile("src/components/orbit-app.tsx", "utf8");
  assert.doesNotMatch(
    ui,
    /process\.env|@orbit\/database\/client|@\/server\/auth/,
  );
  const shared = await readFile("packages/shared/src/dto.ts", "utf8");
  assert.match(shared, /import type/);
});

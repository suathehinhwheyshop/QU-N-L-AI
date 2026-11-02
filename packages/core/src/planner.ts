import { interpretGoal } from "./interpreter";
import {
  NodeSchema,
  OrbitError,
  type Goal,
  type Plan,
  type Node,
} from "@orbit/shared/contracts";
export function validateGraph(nodes: Node[]) {
  if (!nodes.length || nodes.length > 32) throw new OrbitError("BAD_REQUEST");
  const map = new Map(nodes.map((n) => [n.key, n]));
  if (map.size !== nodes.length) throw new OrbitError("BAD_REQUEST");
  const seen = new Set<string>(),
    visiting = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    if (visiting.has(key) || !map.has(key)) throw new OrbitError("BAD_REQUEST");
    visiting.add(key);
    for (const dep of map.get(key)!.depends_on) visit(dep);
    visiting.delete(key);
    seen.add(key);
  };
  nodes.forEach((n) => {
    NodeSchema.parse(n);
    if (new Set(n.depends_on).size !== n.depends_on.length)
      throw new OrbitError("BAD_REQUEST");
    // A gate approves one canonical manifest. Aggregate multiple upstream
    // outputs into that manifest before the gate, rather than approving one
    // arbitrary predecessor and leaving the remaining inputs unbound.
    if (n.kind === "approval" && n.depends_on.length !== 1)
      throw new OrbitError("BAD_REQUEST");
    if (n.effect !== "read") throw new OrbitError("FORBIDDEN_EFFECT");
    visit(n.key);
  });
  return nodes;
}
type Template = (
  goal: Goal,
  kind: string,
) => { template: string; nodes: Node[] };
const templates = new Map<string, Template>();
export function registerTemplate(kind: string, factory: Template) {
  templates.set(kind, factory);
}
export function planGoal(goal: Goal, kind: string): Plan {
  const factory = templates.get(kind);
  if (!factory) throw new OrbitError("BAD_REQUEST");
  const interpretation = interpretGoal(goal, kind);
  const generated = factory(goal, kind);
  const nodes = generated.nodes.map((n) => ({
    ...n,
    input: { ...n.input, goal_contract: interpretation },
  }));
  const template = generated.template;
  validateGraph(nodes);
  return {
    version: 1,
    interpretation,
    template,
    workspace: kind,
    nodes,
    estimate: {
      mode: goal.mode,
      cost_cents: 0,
      notice: "Mock không phát sinh phí API. Chưa có ước tính cho AI thật.",
    },
  };
}

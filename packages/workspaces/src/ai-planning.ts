import { ProposedPlan, OrbitError } from "@orbit/shared/contracts";
const dependencies: Record<string, string[]> = {
  analyze: ["source", "interpret"],
  review: ["source", "analyze", "interpret"],
  board: ["review"],
  approve: ["board"],
  deliver: ["board", "approve"],
};
export function templateAIPlan(objective: string, criteria: string[]) {
  return ProposedPlan.parse({
    objective,
    acceptance_criteria: criteria.length
      ? criteria
      : ["Output có nguồn/checksum và phê duyệt trước khi bàn giao."],
    steps: Object.entries(dependencies).map(([key, depends_on]) => ({
      key,
      depends_on,
      instruction: `Thực hiện bước ${key} theo mục tiêu và tiêu chí đã cấp, chỉ đọc dữ liệu.`,
      effect: "read",
    })),
  });
}
export function validateAIPlan(
  raw: unknown,
  objective: string,
  criteria: string[] = [],
) {
  const plan = ProposedPlan.parse(raw);
  if (plan.objective !== objective) throw new OrbitError("INVALID_OUTPUT");
  if (criteria.some((c) => !plan.acceptance_criteria.includes(c)))
    throw new OrbitError("INVALID_OUTPUT");
  const keys = new Set(plan.steps.map((s) => s.key));
  if (keys.size !== 5) throw new OrbitError("FORBIDDEN_EFFECT");
  for (const step of plan.steps) {
    if (
      [...step.depends_on].sort().join("|") !==
      [...dependencies[step.key]].sort().join("|")
    )
      throw new OrbitError("FORBIDDEN_EFFECT");
  }
  return plan;
}
export const allowedPlanningSteps = dependencies;

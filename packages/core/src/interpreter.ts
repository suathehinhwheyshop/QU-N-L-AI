import { GoalContract, OrbitError, type Goal } from "@orbit/shared/contracts";
export type GoalProfile = {
  kind: string;
  deliverables: string[];
  completionCriteria: string[];
};
const profiles = new Map<string, GoalProfile>();
export function registerGoalProfile(profile: GoalProfile) {
  profiles.set(profile.kind, profile);
}
export function interpretGoal(goal: Goal, kind: string) {
  const profile = profiles.get(kind);
  if (!profile) throw new OrbitError("BAD_REQUEST");
  return GoalContract.parse({
    version: 1,
    strategy: "TEMPLATE",
    objective: goal.goal,
    workspace: kind,
    deliverables: profile.deliverables,
    acceptance_criteria: [
      ...new Set([...profile.completionCriteria, ...goal.acceptance_criteria]),
    ],
    constraints: {
      mode: goal.mode,
      read_only: true,
      external_calls: goal.mode === "LIVE",
      budget_cents: goal.budget_cents,
    },
    notice:
      "Diễn giải theo contract/template, không giả lập suy luận AI hoặc cam kết đạt mục tiêu nghiệp vụ.",
  });
}

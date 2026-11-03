import { NodeSchema, OrbitError, type Goal } from "@orbit/shared/contracts";
import { loadDataset } from "@orbit/integrations/seo-data";
export async function validateSeoGoal(owner: string, goal: Goal) {
  if (goal.seo_dataset_id) {
    if (goal.planning_strategy !== "TEMPLATE")
      throw new OrbitError("SEO_TEMPLATE_REQUIRED");
    const { data } = await loadDataset(owner, goal.seo_dataset_id);
    if (!data.current.length) throw new OrbitError("GSC_EMPTY_DATASET");
  } else if (goal.mode === "LIVE")
    throw new OrbitError("LIVE_SOURCE_UNAVAILABLE");
}
export function seoDatasetTemplate(goal: Goal) {
  if (goal.planning_strategy !== "TEMPLATE")
    throw new OrbitError("SEO_TEMPLATE_REQUIRED");
  const raw = [
    {
      key: "source",
      kind: "tool",
      handler: "seo.dataset.source",
      capability: "read",
      depends_on: [],
      title: "Đọc dataset và tính số liệu có checksum",
    },
    {
      key: "analyze",
      kind: "model",
      handler: "seo.dataset.analyze",
      capability: "seo_analysis",
      depends_on: ["source"],
      title: "AI1 phân tích theo evidence facts",
    },
    {
      key: "review",
      kind: "model",
      handler: "seo.dataset.review",
      capability: "seo_review",
      depends_on: ["source", "analyze"],
      title: "AI2 khác provider kiểm chứng",
    },
    {
      key: "validate",
      kind: "transform",
      handler: "seo.dataset.validate",
      capability: "validate",
      depends_on: ["source", "analyze", "review"],
      title: "Kiểm tra số liệu và nguồn bằng code",
    },
    {
      key: "board",
      kind: "transform",
      handler: "seo.dataset.board",
      capability: "synthesis",
      depends_on: ["source", "validate"],
      title: "Tổng hợp Task Board",
    },
    {
      key: "approve",
      kind: "approval",
      handler: "report.approval",
      capability: "approval",
      depends_on: ["board"],
      title: "Người dùng duyệt bảng việc",
    },
    {
      key: "deliver",
      kind: "report",
      handler: "seo.dataset.deliver",
      capability: "report",
      depends_on: ["board", "approve"],
      title: "Xuất báo cáo MD / CSV / JSON",
    },
  ];
  return {
    template: "seo-dataset-v1",
    nodes: raw.map((n) =>
      NodeSchema.parse({
        ...n,
        acceptance:
          "Read-only; evidence/facts/checksum hợp lệ và approval không bị bỏ qua.",
        timeout_ms: n.kind === "model" && goal.mode === "LIVE" ? 60000 : 10000,
        input: {
          dataset_id: goal.seo_dataset_id,
          mode: goal.mode,
          goal: goal.goal,
          scenario: goal.scenario,
          workspace: "seo",
          ...(n.key === "review" ? { avoid_provider_task: "analyze" } : {}),
        },
      }),
    ),
  };
}

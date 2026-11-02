import { getWorkspace } from "./registry";
import { NodeSchema, type Goal, type Node } from "@orbit/shared/contracts";
export function reviewedTemplate(
  goal: Goal,
  kind: string,
): { template: string; nodes: Node[] } {
  const workspace = getWorkspace(kind);
  const nodes = [
    {
      key: "source",
      title: workspace.sourceTitle,
      handler: workspace.sourceHandler,
      kind: "tool",
      capability: "read",
      depends_on: [],
      acceptance: "Nguồn có schema hợp lệ, nguồn gốc và nhãn MOCK.",
    },
    {
      key: "analyze",
      title: "Phân tích có cấu trúc",
      handler: "report.analyze",
      kind: "model",
      capability: "analysis",
      depends_on: ["source"],
      acceptance: "Nhận định có bằng chứng, giới hạn và trỏ về checksum nguồn.",
    },
    {
      key: "review",
      title: "Đối chiếu bằng AI thứ hai",
      handler: "report.review",
      kind: "model",
      capability: "review",
      depends_on: ["source", "analyze"],
      acceptance:
        "Khác provider phân tích, xác minh nguồn và bổ sung phản biện.",
    },
    {
      key: "board",
      title: "Tạo bảng công việc",
      handler: "report.board",
      kind: "transform",
      capability: "transform",
      depends_on: ["review"],
      acceptance: "Mỗi việc có priority, evidence, URL và tiêu chí hoàn thành.",
    },
    {
      key: "approve",
      title: "Anh xem và phê duyệt",
      handler: "report.approval",
      kind: "approval",
      capability: "approval",
      depends_on: ["board"],
      acceptance: "Quyết định người dùng gắn đúng hash của bảng việc.",
    },
    {
      key: "deliver",
      title: "Kiểm chứng và xuất báo cáo",
      handler: "report.deliver",
      kind: "report",
      capability: "report",
      depends_on: ["board", "approve"],
      acceptance:
        "Báo cáo đúng schema, artifact có checksum và approval hợp lệ.",
    },
  ].map((n) =>
    NodeSchema.parse({
      ...n,
      input: {
        goal: goal.goal,
        site: goal.site,
        scenario: goal.scenario,
        workspace: kind,
        attachment_ids: goal.attachment_ids,
        ...(n.key === "review" ? { avoid_provider_task: "analyze" } : {}),
      },
    }),
  );
  return { template: workspace.template, nodes };
}

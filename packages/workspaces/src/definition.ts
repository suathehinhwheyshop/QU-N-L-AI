import type { z } from "zod";
import type { Analysis } from "@orbit/shared/contracts";
export type FixtureContext = {
  goal: string;
  site: string;
  source_sha256: string;
};
export type WorkspaceModule = {
  kind: string;
  name: string;
  template: string;
  sourceHandler: string;
  sourceTitle: string;
  deliverables: string[];
  completionCriteria: string[];
  fixture: (input: FixtureContext) => z.infer<typeof Analysis>;
};
export function reportFixture(
  name: string,
  items: { id: string; title: string; acceptance: string }[],
  input: FixtureContext,
): z.infer<typeof Analysis> {
  return {
    summary: `[MOCK] ${name}: ${input.goal}`,
    findings: items.map((item, i) => ({
      ...item,
      url: input.site,
      priority: i === 0 ? "P1" : "P2",
      reason:
        "Đề xuất fixture để kiểm thử workflow; chưa phải kết quả phân tích AI thật.",
      evidence: `Nguồn MOCK, checksum ${input.source_sha256}`,
    })),
    limitations: [
      "Dữ liệu và nhận định minh họa, chưa kiểm chứng thông tin bên ngoài.",
      "Chỉ lập kế hoạch/báo cáo; chưa tạo media, chạy code hoặc sửa dịch vụ thật.",
    ],
    source_sha256: input.source_sha256,
  };
}

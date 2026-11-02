import { reportFixture, type WorkspaceModule } from "./definition";
export const researchWorkspace: WorkspaceModule = {
  kind: "research",
  name: "Research Workspace",
  template: "research-report-v1",
  sourceHandler: "research.source",
  sourceTitle: "Chuẩn bị hồ sơ nghiên cứu mẫu",
  deliverables: [
    "Câu hỏi nghiên cứu và bảng nguồn",
    "Báo cáo cùng giới hạn nhận định",
  ],
  completionCriteria: [
    "Phân biệt dữ kiện, giả thuyết và điều chưa biết.",
    "Nhận định có nguồn; không giả tìm kiếm web đã thực hiện.",
    "Người dùng duyệt báo cáo.",
  ],
  fixture: (input) =>
    reportFixture(
      "Kế hoạch nghiên cứu",
      [
        {
          id: "RESEARCH-01",
          title: "Xác định câu hỏi và phạm vi nghiên cứu",
          acceptance:
            "Có câu hỏi, nhóm nguồn ưu tiên và điều kiện chấp nhận bằng chứng.",
        },
        {
          id: "RESEARCH-02",
          title: "Đối chiếu nguồn và các nhận định mâu thuẫn",
          acceptance:
            "Lưu trích dẫn, thời điểm và mức chắc chắn; mock chưa truy cập web.",
        },
      ],
      input,
    ),
};

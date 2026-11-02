import { reportFixture, type WorkspaceModule } from "./definition";
export const developmentWorkspace: WorkspaceModule = {
  kind: "development",
  liveInput: true,
  name: "Development Workspace",
  template: "development-plan-v1",
  sourceHandler: "development.source",
  sourceTitle: "Chuẩn bị yêu cầu phát triển mẫu",
  deliverables: ["Kế hoạch triển khai và test", "Danh sách task kỹ thuật"],
  completionCriteria: [
    "Task có dependency và acceptance criteria.",
    "Không báo build/test code bên ngoài đã chạy khi chưa có evidence.",
    "Người dùng duyệt kế hoạch.",
  ],
  fixture: (input) =>
    reportFixture(
      "Kế hoạch phát triển",
      [
        {
          id: "DEV-01",
          title: "Chuyển yêu cầu thành task kỹ thuật",
          acceptance:
            "Mỗi task có đầu vào, đầu ra, dependency và test cần chạy.",
        },
        {
          id: "DEV-02",
          title: "Thiết kế kiểm thử và cách kiểm chứng bàn giao",
          acceptance:
            "Có lệnh kiểm tra dự kiến; không giả định đã sửa repository khác.",
        },
      ],
      input,
    ),
};

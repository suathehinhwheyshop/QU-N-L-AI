import { reportFixture, type WorkspaceModule } from "./definition";
export const seoWorkspace: WorkspaceModule = {
  kind: "seo",
  liveInput: false,
  name: "SEO Workspace",
  template: "seo-readonly-v1",
  sourceHandler: "seo.source",
  sourceTitle: "Đọc dữ liệu GSC mẫu",
  deliverables: [
    "Bảng cơ hội SEO có bằng chứng",
    "Báo cáo phân tích và phản biện",
  ],
  completionCriteria: [
    "Nhận đúng nguồn dữ liệu và giữ checksum.",
    "Mỗi đề xuất có URL, bằng chứng và tiêu chí kiểm tra.",
    "Người dùng duyệt trước khi xuất báo cáo.",
  ],
  fixture: (input) =>
    reportFixture(
      "Kế hoạch SEO",
      [
        {
          id: "SEO-01",
          title: "Đối chiếu CTR theo trang và truy vấn",
          acceptance:
            "Xác minh GSC thật cùng khoảng ngày/bộ lọc trước khi kết luận.",
        },
        {
          id: "SEO-02",
          title: "Rà soát giả thuyết cải thiện nội dung",
          acceptance:
            "Đối chiếu trang và nguồn sản phẩm thật; chưa tự sửa website.",
        },
      ],
      input,
    ),
};

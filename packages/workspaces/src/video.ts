import { reportFixture, type WorkspaceModule } from "./definition";
export const videoWorkspace: WorkspaceModule = {
  kind: "video",
  liveInput: true,
  name: "Video Studio",
  template: "video-brief-v1",
  sourceHandler: "video.source",
  sourceTitle: "Chuẩn bị brief video mẫu",
  deliverables: ["Brief và bố cục video", "Danh sách asset cần chuẩn bị"],
  completionCriteria: [
    "Brief có đối tượng xem, thông điệp và tiêu chí bàn giao.",
    "Không báo video đã render khi chưa có bằng chứng media.",
    "Người dùng duyệt kế hoạch.",
  ],
  fixture: (input) =>
    reportFixture(
      "Kế hoạch video",
      [
        {
          id: "VIDEO-01",
          title: "Xây dựng bố cục kịch bản theo brief",
          acceptance: "Có phần mở đầu, các cảnh và thông điệp cần kiểm tra.",
        },
        {
          id: "VIDEO-02",
          title: "Lập danh sách hình, âm thanh và callout",
          acceptance:
            "Mỗi asset có nguồn và yêu cầu sử dụng; chưa tạo file video thật.",
        },
      ],
      input,
    ),
};

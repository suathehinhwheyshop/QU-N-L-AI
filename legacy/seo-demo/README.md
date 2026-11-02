# Orbit — quy trình GSC → tối ưu SEO cá nhân

Prototype web dùng Node.js 24, không có thư viện bên ngoài hay bước cài dependency.

```sh
cd /workspace/QU-N-L-AI
npm start
```

PORT mặc định 3000, có thể đổi bằng `PORT=3100 npm start`. Đây là máy chủ bản mẫu; chưa triển khai URL công khai. Mở ứng dụng qua HTTP do server phục vụ, không mở index.html bằng file:// vì dùng JavaScript modules.

## Thử luồng

1. Mở quy trình có sẵn hoặc “Giao mục tiêu mới”. Chọn website, khoảng ngày, hồ sơ/model mong muốn và phạm vi sửa.
2. “Chạy thử quy trình”: tự mô phỏng sáu bước, khoảng 11 giây. Có tạm dừng/tiếp tục.
3. Xem Bảng công việc, đối chiếu trước/sau và lưu ghi chú. Việc ngoài phạm vi không được thực hiện.
4. Xuất CSV (mở được bằng Excel) hoặc hồ sơ JSON. JSON là bản sao, chưa có import. CSV chưa đồng bộ hai chiều với Excel.
5. Thử mục tiêu mới với “Lỗi lấy GSC lần đầu”, sau đó “Chạy lại bước lỗi”.
6. Tải lại khi đang chạy: luồng tạm dừng, giữ đầu ra cũ và chờ anh tiếp tục.

## Giới hạn hiện tại

Mọi dữ liệu, AI output, sửa website và kiểm tra đều là mô phỏng. Chưa có đăng nhập, đồng bộ giữa máy, kết nối Grokbot/Claude/GSC/CMS, Gmail hay bộ chạy nền. Trang phải đang mở để mô phỏng tiến triển; dữ liệu lưu localStorage, có thể bị xóa theo trình duyệt. Không nhập thông tin nhạy cảm. Hai tab không phải một cơ chế khóa công việc bền vững.

Bản demo Orbit tổng quát cũ được giữ nguyên ở orbit-general-demo.html; orbit-mobile.html là bản cũ độc lập. LocalStorage SEO dùng khóa mới, không ghi đè dữ liệu cũ.

## Kiểm tra

`npm test` chạy kiểm thử engine và HTTP server. Server test cần quyền mở socket loopback. Các test xác minh bàn giao, lỗi/retry, phạm vi, hồi phục, export CSV, route và loại nội dung. Kiểm tra trình duyệt bổ sung được ghi tại docs/VALIDATION.md khi thực hiện.

Xem [Lộ trình triển khai](docs/GSC-SEO-ROADMAP.md) cho từng bước từ prototype đến kết nối thật. Phạm vi cá nhân, một website đầu tiên; không cần Linear hoặc hạ tầng trả phí mới để thử giao diện.

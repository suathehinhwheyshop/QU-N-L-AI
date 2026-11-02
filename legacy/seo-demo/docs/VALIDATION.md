# Xác minh bản mẫu Orbit SEO

Ngày kiểm tra: 02/11/2026 (Asia/Ho_Chi_Minh).

## Đã qua

- `npm test`: 7 kiểm thử, 7 qua, 0 lỗi, 0 bỏ qua. Cần cho phép mở socket cục bộ trong sandbox cho HTTP test.
- Engine: nguồn/config được bàn giao, phạm vi được giữ, kết thúc có việc bị chặn, luồng đủ quyền, lỗi/retry không tạo trùng, hồi phục sau tải lại, giữ ghi chú, xác thực URL/ngày và chống công thức trong CSV.
- HTTP: trang và JS/CSS trả đúng nội dung; HEAD; 404 cho đường dẫn lạ và metadata Git; 405 cho POST.
- Chromium qua CDP: chạy thật thao tác UI. Tạm dừng/tải lại/tiếp tục; tạo bốn việc, ghi chú, bộ lọc, tìm kiếm, sáu đầu ra; báo cáo không tuyên bố sửa website; tạo luồng lỗi và chạy lại; không có runtime exception.
- Năm màn hình kiểm tra tại 390 và 430 px không tràn ngang.
- Ảnh trong previews/ là ảnh chụp thật của ứng dụng sau khi hoàn tất mô phỏng, không phải hình vẽ. Có 3 việc được kiểm tra trong demo và 1 việc bị chặn ngoài phạm vi.

## Chạy lại kiểm thử trình duyệt

1. `PORT=3100 npm start`.
2. Mở Chromium headless với thư mục profile thử riêng, `--remote-debugging-port=9229`. Trong container đang dùng cần `--no-sandbox --disable-dev-shm-usage`; đây không phải cấu hình triển khai app.
3. `node tests/browser-smoke.mjs`. Script xóa riêng khóa localStorage `orbit-seo-demo-v1` trong profile thử, chạy UI và cập nhật ảnh chụp. Không dùng profile cá nhân có dữ liệu thật.

## Chưa xác minh / chưa triển khai

Kết nối Grokbot, model/project Claude, GSC, Gmail, sửa CMS thật, hoàn tác thật, Excel hai chiều, đăng nhập, lưu cloud, nhiều thiết bị, runner hoạt động khi đóng trình duyệt và URL public. Không dùng kết quả mô phỏng để kết luận website đã tối ưu hoặc có tăng trưởng SEO.

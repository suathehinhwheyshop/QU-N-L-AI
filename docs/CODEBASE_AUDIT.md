# Audit trước khi hoàn thiện Phase 1

Thời điểm: 02/11/2026, Asia/Ho_Chi_Minh. Phạm vi: code đang có trước lượt sửa này; bằng chứng test cũ không thay cho chạy lại.

| Thành phần                                                           | Phân loại ban đầu                   | Nhận định / hành động                                                                   |
| -------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| Next.js UI và API                                                    | Code hoạt động                      | Gọi API thật; giữ visual, tránh hiển thị output MOCK như kết quả AI thật                |
| PostgreSQL / Drizzle / migrations                                    | Code hoạt động                      | 12 bảng, durable task/attempt/artifact; giữ, kiểm tra lại migration                     |
| DAG, worker, checkpoint, retry, timeout, budget, pause/resume/cancel | Code hoạt động                      | Đã có triển khai; cần chạy lại test độc lập và kiểm chứng restart ứng dụng              |
| Approval / artifacts / audit                                         | Code hoạt động                      | Hash-bound approval, file thật, checksum và lineage; giữ và kiểm tra                    |
| Planner                                                              | Template implementation             | Chưa có Goal Interpreter riêng; cần bổ sung contract mục tiêu và điều kiện hoàn thành   |
| Provider layer                                                       | Hai adapter MOCK, bốn metadata hãng | Mock chứa fixture SEO; chưa có bốn adapter module độc lập / cấu hình model có hiệu lực  |
| Workspace layer                                                      | SEO + fallback chung                | Video/Research/Development chưa có module riêng; cần tách nghiệp vụ và fixtures         |
| Shared packages                                                      | Chưa tách                           | Cần npm workspace packages và kiểm tra ranh giới import frontend/backend                |
| GSC                                                                  | MOCK fixture connector              | Không có OAuth/API thật; không đánh dấu CONNECTED                                       |
| HTML trước đây                                                       | Giao diện mô phỏng được lưu trữ     | Chỉ nằm trong legacy, không phải nền tảng đang chạy và không phải bằng chứng nghiệm thu |
| Auth / storage                                                       | Development implementation          | Auth local và filesystem; chưa production OIDC/object storage/backup                    |
| E2E cũ                                                               | Có HTTP + worker + PostgreSQL       | Mới restart worker; bổ sung restart API server và acceptance matrix 10 điều kiện        |
| Git                                                                  | Chưa có local commit                | Tạo branch riêng, giữ nguyên files, commit/push không merge main                        |

Phạm vi khắc phục: chỉ Phase 1, không gọi API bên ngoài và không sửa website. Việc có module/capability/mock không đồng nghĩa có kết nối dịch vụ thật.

Các sửa chữa đang triển khai sau audit: npm shared packages có tên riêng; Goal Interpreter theo contract/template; bốn workspace module riêng; bốn adapter MOCK theo hãng với model IDs mang nhãn mock; cấu hình model/enable có backend; E2E restart cả web server và worker. Chỉ cập nhật kết quả nghiệm thu sau khi chạy kiểm thử mới.

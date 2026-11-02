# Phase 1 — Ma trận nghiệm thu sau audit

> Bằng chứng lịch sử của Phase 1 (`9f07558`). Baseline chạy lại được giữ tại `docs/evidence/phase1-baseline/`; regression của branch Phase 2 ở [PHASE2_VALIDATION.md](PHASE2_VALIDATION.md).

Phạm vi: Universal Multi-AI Foundation. SEO chỉ là workflow E2E đầu tiên. Không gọi API ngoài, không sửa website. Kết quả thực thi engine/backend là thật; nội dung AI/GSC là MOCK.

| #   | Điều kiện                         | Bằng chứng đã thực thi                                                                                   | Kết quả     |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Goal tạo workflow và lưu database | HTTP POST runs, idempotent request key; GET từ ứng dụng sau restart vẫn trả đúng run ID                  | PASS        |
| 2   | Task có dependency                | 6 task, 7 edges lưu PostgreSQL; DAG kiểm cycle/missing/duplicate và node budget                          | PASS        |
| 3   | Worker dùng mock adapters         | Hai provider IDs khác nhau trong attempts; bốn vendor modules có unit tests                              | PASS — MOCK |
| 4   | Lưu và truyền output              | Source → analysis → review → board; schema/checksum, lineage và artifact có bytes thật                   | PASS        |
| 5   | Validation, lỗi và retry          | Integration test sai schema/corrupt artifact/timeout; E2E fail-once có FAILED attempt và RETRY_SCHEDULED | PASS        |
| 6   | Pause/resume/cancel backend       | E2E gọi HTTP controls, đọc lại PAUSED/CANCELED; integration chặn downstream và output đến muộn           | PASS        |
| 7   | Trạng thái qua restart ứng dụng   | E2E restart web server và worker, đối chiếu plan/output, approval và session còn hợp lệ                  | PASS        |
| 8   | Approval và artifacts             | Sai hash/owner bị chặn; duyệt đúng mới delivery; 6 artifact verified checksum                            | PASS        |
| 9   | UI lấy dữ liệu backend            | Browser upload/plan/run/approval/config/settings/artifacts; đọc API xác nhận model config lưu thật       | PASS        |
| 10  | Tests thực thi, có evidence       | 14 unit + 10 PostgreSQL integration, E2E và browser; log/JSON/screenshots trong docs/evidence            | PASS        |

Bằng chứng máy đọc được: [verification.json](evidence/verification.json), [E2E run](evidence/phase1-e2e.json), [browser](evidence/browser-checks.json). E2E JSON chứa run/task IDs, dependencies, attempts, provider IDs, approval hash, artifact checksums và controls/retry probe. Database test riêng được dọn sau kiểm thử; metadata evidence giữ lại để review.

Các workspace ngoài SEO cũng được integration test trên cùng engine: Video/Research/Development tạo output theo domain riêng, approval và report, không dùng fixture SEO.

## Giới hạn không bị che bằng trạng thái PASS

- Goal Interpreter/Planner là contract/template, chưa AI planning tự do.
- Bốn vendor adapters ở chế độ MOCK; API LIVE của Anthropic/OpenAI/Google/xAI chưa triển khai/kiểm chứng.
- Video/Research/Development mới lập kế hoạch và báo cáo fixture; không render media, tìm web hay thực thi code bên ngoài.
- Upload lưu bytes thật nhưng mock chưa phân tích nội dung upload.
- Auth local, filesystem artifacts và coordinator lock phù hợp development; chưa public production, OIDC, object storage hoặc backup/restore drill.
- Side effects ghi bị policy từ chối; ledger chưa được kiểm chứng với API ngoài. Không tự nhận exactly-once cho dịch vụ không hỗ trợ idempotency.
- Không dùng tiêu chí Foundation để tuyên bố Phase 2/3 hay kết quả SEO thật đã hoàn tất.

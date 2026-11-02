# Phase 2 — báo cáo kiểm chứng

Branch triển khai: `orbit/phase2-real-multi-ai`, từ parent `9f07558652b1cf4be46c64d2ccaf23a55c311280`. Không merge main. Thời điểm kiểm chứng: 02/11/2026 UTC. Xem timestamps trong JSON/logs, không dùng báo cáo HTML prototype làm bằng chứng.

## Kết quả và giới hạn nghiệm thu

**Code Phase 2 và offline regression đã được triển khai. Chưa tuyên bố Phase 2 REAL MULTI-AI được nghiệm thu.** `verify:live` ghi BLOCKED, `real_api_verified=false`, vì cả bốn ORBIT_*_API_KEY vắng mặt. Chưa có hai API responses, quyền model hoặc chi phí invoice thật. Draft môi trường đã lưu domains/secret requirements/start instructions nhưng chưa apply/publish; không có secret binding mới.

| Kiểm thử                       | Kết quả                                                      | Bằng chứng                                 |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| Baseline parent trước sửa      | PASS: 14 unit, 10 integration, typecheck/build/E2E           | evidence/phase1-baseline/verification.json |
| Unit + HTTP protocol tests     | PASS: 19, không skip                                         | evidence/unit.log                          |
| PostgreSQL integration         | PASS: 19 = 10 Foundation + 9 Phase 2                         | evidence/integration.log                   |
| TypeScript và production build | PASS                                                         | evidence/typecheck.log, build.log          |
| E2E Foundation                 | PASS, backend HTTP + worker process + DB, restart app/worker | evidence/phase1-e2e.json                   |
| E2E planning                   | PASS, 7 tasks/7 artifacts, approval và hai MOCK providers    | evidence/phase2-offline-e2e.json           |
| Browser regression             | PASS: 10 nhóm, 8 màn hình ở 390 px, không runtime exceptions | evidence/browser-checks.json, screenshots  |
| Official live API workflow     | BLOCKED, chưa gọi API thật                                   | evidence/phase2-live.json                  |

`npm run verify:phase2` giữ exit status từng command, từ chối zero-test và kiểm tra evidence E2E mới trong lượt chạy. Summary: evidence/phase2-offline-verification.json. Browser test chạy riêng sau restart development app/worker.

## Đã kiểm chứng offline

- Bốn protocol adapters build/parse thật qua HTTP server local, auth header đúng, usage chuẩn hóa, không SDK retry ẩn. Tất cả có evidence HTTP_STUB và adapter mode MOCK.
- Input cap trước network, sanitized errors, timeout, HTTP 401/429/503, invalid JSON, redaction. Router phân biệt capability, giá, latency, availability và data policy.
- AI ProposedPlan strict, giữ objective/criteria và đúng allowlisted read-only topology; loại thay effect/bỏ approval/thay dependencies. Không hợp lệ fallback template có reason và vẫn đi qua gate.
- Hai HTTP adapters truyền structured data qua persisted tasks/attempts/artifacts. Checksums nguồn bind analysis/review, review sai hash không sinh board/approval.
- 5xx outcome không chắc chắn tiêu reservation, budget chặn retry tiếp; 429 retry/backoff không giả tính phí request bị từ chối. Snapshot bảo vệ in-flight attempt khi operator đổi giá. Cancel giữ reported cost/usage, discard output.
- HTTP_STUB successful protocol hoặc synthetic stub probe receipt không kích hoạt LIVE, kể cả test credential-present. Đây là fault injection trong database test riêng, không phải official API proof.
- Backend/API/worker process E2E vẫn giữ auth/ownership, restart, pause/resume/cancel/retry, checksum-bound approval và artifact download. Thêm planning stage; API loại provider_snapshot trước khi trả về UI. Không key trong browser.

## Code/tài liệu chính

7 packages giữ nguyên. providers thêm transport/live-adapter/live-registry và wires trong bốn vendor modules; core thêm live-policy và mở rộng tối thiểu registry/executor/accounting. workspaces thêm ai-planning/interpret handler, giữ business logic ngoài core. Server thêm live catalog/probe và API/model settings; UI có mode/planning/model/pricing/policy controls thật.

Migrations 0002 thêm provider model_config + provider_probes (14 bảng); 0003 thêm attempt provider_snapshot. scripts/live-smoke.ts và verify-phase2.mjs; test/unit/phase2.test.ts, test/integration/phase2.test.ts, test/phase2-support.ts; E2E workflow mở rộng. README, ARCHITECTURE, DATABASE_SCHEMA, ROADMAP, TASKS và docs/phase2 được cập nhật.

## Chưa hoàn thiện và bước tiếp theo

Chưa kiểm thử bốn endpoints chính thức với tài khoản thật. Tối thiểu hai API keys/quota, model/pricing, egress/policy và probe là prerequisites; cấu hình an toàn trong environment settings, không gửi secret qua chat. Sau review/save/publish, restart web/worker, probe và chạy `npm run verify:live -- --execute`. Script dừng WAITING_APPROVAL, không tự duyệt. Người dùng duyệt run, kiểm tra final artifacts, usage/evidence rồi lưu bằng chứng để nghiệm thu LIVE.

AI planning chỉ trong template cố định đã duyệt, chưa arbitrary workflow generator. Reliability hiện là hằng số; latency lấy từ probe, chưa đo lịch sử/circuit breaker. Chi phí theo giá operator/cents rounding, chưa đối soát invoice hoặc remote spending limits. Upload chưa trích nội dung vào prompt. Không GSC thật, CMS write, tool/agent hosting của hãng, streaming hoặc image/video API. Không production auth/object storage/monitoring/deployment/backup hardening. Giữ các việc đó trong Phase 3/4, không mở rộng để che thiếu LIVE evidence.

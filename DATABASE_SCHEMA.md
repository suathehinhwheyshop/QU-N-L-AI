# ORBIT — Database schema

Nguồn định nghĩa chuẩn: packages/database/src/schema.ts và migrations/ do Drizzle generate. PostgreSQL 17. Mọi bản ghi thời gian là timestamptz; ID chính là UUID. Cents là số nguyên USD, mock không phát sinh phí.

| Bảng              | Nội dung và ràng buộc chính                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users             | Tài khoản local, email unique; không chứa API secret                                                                                                                                          |
| workspaces        | Owner, slug, loại nghiệp vụ; unique(owner, slug)                                                                                                                                              |
| settings          | Một bản cấu hình/owner: ngân sách và concurrency; read-only policy bắt buộc ở MVP                                                                                                             |
| connections       | Provider/model metadata, capabilities, MOCK/DISCONNECTED/CONNECTED, health check timestamp; không có cột secret                                                                               |
| provider_configs  | Cấu hình owner/provider: enabled, model, model_config (giá/token caps/nguồn/ngày), updated_at; composite PK(owner_id, provider_id), không lưu secret                                          |
| runs              | Goal, config, plan version, mode, trạng thái, budget/spent/reserved, request idempotency key unique theo owner                                                                                |
| tasks             | Run, task key unique trong run, kind/handler/capability, schemas, dependency, status, priority, output, lease, attempt fencing, acceptance criteria                                           |
| task_dependencies | DAG edges, composite key; planner kiểm tra dependency tồn tại, cùng run, không cycle                                                                                                          |
| attempts          | Task, attempt number unique, provider/model, status, timeout, reserve/estimated cost, usage/evidence, provider_snapshot (pricing/credential HMAC tag), mã lỗi; không lưu raw error/credential |
| approvals         | Task/run, output checksum, trạng thái pending/approved/rejected và actor/time; một gate mỗi task                                                                                              |
| artifacts         | Owner/run/task/attempt, version, checksum, media type, blob key, nguồn và mode; unique(task, kind, version)                                                                                   |
| events            | Audit append-only qua service: run/task/attempt IDs, event type và safe message                                                                                                               |
| action_ledger     | Key duy nhất cho future external effects; Phase 1 không cho phép ghi bên ngoài                                                                                                                |

Trạng thái workflow: QUEUED, RUNNING, PAUSED, WAITING_APPROVAL, COMPLETED, FAILED, CANCELED. Task có thêm PENDING. Mode MOCK/LIVE tách biệt trạng thái; LIVE cần admission từ probe API chính thức, không từ HTTP stub. Kết nối thật chỉ CONNECTED sau probe thành công bằng adapter chính thức, mock luôn MOCK.

Tác vụ và attempts checkpoint trong PostgreSQL. Claim/reserve/attempt/event cùng transaction; output/artifact/cost/event cùng transaction khi hoàn thành. Foreign key giữ quan hệ, unique chống duplicate create-run/task/attempt/artifact. Artifact bytes nằm ngoài database, checksum và metadata trong database. Ghi blob trước DB commit có thể để orphan khi crash; không để DB trỏ blob chưa có. Cleanup orphan và lifecycle policy thuộc hardening.

Migrations có version và checksum bằng Drizzle; không dùng schema push phá dữ liệu. Test database riêng được tạo để integration tests không xóa dữ liệu development. Backup/restore thực nghiệm thuộc Phase 4, chưa coi volume local là backup.

Có 18 bảng (14 bảng ở Phase 2 + 4 bảng Phase 3). Migration 0000 tạo nền tảng; 0001 bổ sung provider_configs mà không reset data cũ. Goal contract và acceptance criteria lưu trong runs.plan và input của tasks. Mock model config có allowlist; LIVE model/config cần probe trên server và được router sử dụng; không chỉ là giá trị hiển thị. Chạy lại migration/seed giữ nguyên run và cấu hình đã chỉnh.

## Migrations Phase 2

- `0002_melodic_legion.sql`: provider_configs.model_config JSONB; bảng provider_probes với owner/provider/model, kind/status, config_hash, credential_tag HMAC, latency, cost/reserved, usage, capabilities, error_code và timestamps; index(owner,provider,created_at).
- `0003_attempt_provider_snapshot.sql`: attempts.provider_snapshot JSONB. Giá/model/credential binding được giữ cho attempt; thay cấu hình sau claim không đổi reservation cũ. Cột này chỉ server, API trả attempts đã loại snapshot.

`provider_probes` là ledger append cho probes và invocation failure làm mất readiness. VERIFIED + LIVE_API không hết hạn + đúng model/config_hash/credential_tag mới đủ điều kiện cho router. HTTP_STUB, FAILED, RUNNING, expired hoặc giá thay đổi không kích hoạt kết nối. catalog CONNECTED dẫn xuất theo owner, không ghi trạng thái chung làm nguồn sự thật. INVOCATION_FAILURE không double-charge, chi phí task đã thuộc attempts/runs. Probe reservations được quyết toán khi success/failure; lần probe tiếp theo settle RUNNING đã quá một phút theo hướng conservative.

API credentials chỉ ở environment; database lưu HMAC tag cho binding, không API keys. Usage/pricing là ước tính USD, làm tròn lên cents, gồm nhãn UNCERTAIN_RESERVED_CHARGED khi không biết hóa đơn thật. Retrying inference có thể bị tính tiền nhiều lần. Không coi ledger local là xác nhận invoice.

## Migration 0004 — GSC/datasets

| Bảng             | Nội dung                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gsc_accounts     | Owner PK/FK, status/kind/scope, access/refresh ciphertext, expiry, property discovery receipt/error/time. Không plaintext tokens.                                                                                   |
| gsc_oauth_states | State hash PK, owner FK, browser hash, encrypted PKCE verifier, expiry/consume time; single-use/TTL enforced in service.                                                                                            |
| gsc_jobs         | Owner/request key unique, run_id unique/FK, SearchRequest spec, page/cursor checkpoint và dataset ID. Queue và attempts vẫn dùng runs/tasks/attempts hiện tại.                                                      |
| seo_datasets     | Owner/request key unique, job_id unique/FK, request hash, property/period/filter spec, normalized blob checksum/key, optional imported raw source checksum/key, row counts/warnings/time. DTO bỏ private blob keys. |

OAuth states/tokens không trả qua bootstrap/API; chỉ status/property/expiry/receipt. gsc_jobs.checkpoint giữ normalized page blobs, không bearer header. Final dataset một lần theo job/request key; retries có thể để orphan blob nhưng không tạo metadata duplicate. Dataset ID ở jobs được service ghi sau khi dataset tồn tại; không circular FK; mọi load kiểm tra owner/hash.

Nguồn GSC_API/HTTP_STUB/IMPORT độc lập với run.mode MOCK/LIVE (AI mode). GSC ingestion run là tool-only và không gọi AI. Imported raw bytes tối đa 5 MB; normalized dataset tối đa 20 MB, 50.000 dòng/kỳ. So sánh cùng filters, equal nonoverlapping windows.

Core artifact renderer persist 3 extra report rows (report_md/report_csv/report_json) cùng transaction delivery. Unique(task,kind,version) và attempt fence giữ integrity; source_ids bind board/approval, report payload bind dataset/facts/source hashes. Download check owner/checksum và media extension.

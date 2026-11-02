# ORBIT — Database schema

Nguồn định nghĩa chuẩn: packages/database/src/schema.ts và migrations/ do Drizzle generate. PostgreSQL 17. Mọi bản ghi thời gian là timestamptz; ID chính là UUID. Cents là số nguyên USD, mock không phát sinh phí.

| Bảng              | Nội dung và ràng buộc chính                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| users             | Tài khoản local, email unique; không chứa API secret                                                                                                |
| workspaces        | Owner, slug, loại nghiệp vụ; unique(owner, slug)                                                                                                    |
| settings          | Một bản cấu hình/owner: ngân sách và concurrency; read-only policy bắt buộc ở MVP                                                                   |
| connections       | Provider/model metadata, capabilities, MOCK/DISCONNECTED/CONNECTED, health check timestamp; không có cột secret                                     |
| provider_configs  | Cấu hình owner/provider: enabled, model, updated_at; composite PK(owner_id, provider_id), không lưu secret                                          |
| runs              | Goal, config, plan version, mode, trạng thái, budget/spent/reserved, request idempotency key unique theo owner                                      |
| tasks             | Run, task key unique trong run, kind/handler/capability, schemas, dependency, status, priority, output, lease, attempt fencing, acceptance criteria |
| task_dependencies | DAG edges, composite key; planner kiểm tra dependency tồn tại, cùng run, không cycle                                                                |
| attempts          | Task, attempt number unique, provider/model, status, timeout, reserve/actual cost, mã lỗi; không lưu raw error/credential                           |
| approvals         | Task/run, output checksum, trạng thái pending/approved/rejected và actor/time; một gate mỗi task                                                    |
| artifacts         | Owner/run/task/attempt, version, checksum, media type, blob key, nguồn và mode; unique(task, kind, version)                                         |
| events            | Audit append-only qua service: run/task/attempt IDs, event type và safe message                                                                     |
| action_ledger     | Key duy nhất cho future external effects; Phase 1 không cho phép ghi bên ngoài                                                                      |

Trạng thái workflow: QUEUED, RUNNING, PAUSED, WAITING_APPROVAL, COMPLETED, FAILED, CANCELED. Task có thêm PENDING. Mode MOCK/LIVE tách biệt trạng thái; LIVE chưa được kích hoạt. Kết nối thật chỉ CONNECTED sau probe thành công bằng adapter chính thức, mock luôn MOCK.

Tác vụ và attempts checkpoint trong PostgreSQL. Claim/reserve/attempt/event cùng transaction; output/artifact/cost/event cùng transaction khi hoàn thành. Foreign key giữ quan hệ, unique chống duplicate create-run/task/attempt/artifact. Artifact bytes nằm ngoài database, checksum và metadata trong database. Ghi blob trước DB commit có thể để orphan khi crash; không để DB trỏ blob chưa có. Cleanup orphan và lifecycle policy thuộc hardening.

Migrations có version và checksum bằng Drizzle; không dùng schema push phá dữ liệu. Test database riêng được tạo để integration tests không xóa dữ liệu development. Backup/restore thực nghiệm thuộc Phase 4, chưa coi volume local là backup.

Có 13 bảng. Migration 0000 tạo nền tảng; 0001 bổ sung provider_configs mà không reset data cũ. Goal contract và acceptance criteria lưu trong runs.plan và input của tasks. Model config có API ghi thật, allowlist trên server và được router sử dụng; không chỉ là giá trị hiển thị. Chạy lại migration/seed giữ nguyên run và cấu hình đã chỉnh.

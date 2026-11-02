# ORBIT — kiến trúc nền tảng V1

## Quyết định trước khi triển khai

- Next.js 16 App Router + TypeScript, React 19, Tailwind 4: cùng kiểu dữ liệu cho UI/API, server runtime Node; giữ visual của prototype trong legacy/seo-demo. Không lấy localStorage làm database.
- PostgreSQL 17 + Drizzle: giao dịch, ràng buộc và `FOR UPDATE SKIP LOCKED` cho durable queue. Không thêm Redis/Temporal ở Phase 1: quy mô cá nhân chưa cần thêm dịch vụ, dễ kiểm tra checkpoint và khôi phục. Worker độc lập với vòng đời request/browser.
- ArtifactStore interface: content-addressed filesystem cho development, checksum + version + lineage trong PostgreSQL. Object storage GCS/S3 là adapter Phase 4, chưa tuyên bố đã triển khai.
- Auth Phase 1: một tài khoản development, password phía server, cookie HttpOnly ký HMAC, hạn dùng, kiểm tra Origin cho request thay đổi. Server mặc định loopback. OIDC, multi-user provisioning, rate-limit phân tán và review bảo mật thuộc Phase 4; chưa cho phép public production.
- Không cần API key để kiểm thử core. LIVE chưa được bật; bốn vendor mock adapters có metadata MOCK rõ ràng, không giả Connected.

## Các lớp

`UI/API → Planner + Policy → PostgreSQL DAG → Worker → Provider/Tool registry → Validation → ArtifactStore`

Core chỉ biết contract task, schema, capability, dependency, effect và policy. Nó không import nghiệp vụ SEO. Workspace registry cung cấp template/handlers. Bốn workspace là module độc lập: SEO, Video, Research, Development. Mỗi module có template, source handler, deliverables, acceptance criteria và fixture riêng. Dùng chung engine; chưa render video hoặc thực thi code bên ngoài.

Goal Interpreter tạo contract chứa objective, deliverables, acceptance criteria của người dùng và constraints read-only/MOCK. Planner Phase 1 là deterministic template planner: chọn workspace/template, gắn goal/acceptance criteria, dựng DAG đã kiểm tra cycle và node budget. Chưa phải AI tự suy luận kế hoạch tùy ý. Input/output của từng handler được Zod kiểm tra. Task Router lọc capability, data policy, availability rồi chấm theo cost/latency/reliability. Bước review tránh provider vừa phân tích; không gán cố định vai trò cho hãng AI.

## Durable execution

Task claim dưới transaction và row lock SKIP LOCKED; ghi Run/Task/Attempt ID, reservation và lease trước khi gọi adapter. Không giữ transaction trong lúc gọi AI. Result commit kiểm tra attempt token và run status, ghi output, artifact, cost và event cùng giao dịch. Lease hết hạn chuyển attempt sang interrupted, bounded retry có exponential backoff. Read-only calls có thể chạy lại; kết quả cũ bị fencing chặn.

Pause ngăn nhận bước mới; bước đang chạy có thể hoàn tất checkpoint. Cancel chặn dependent tasks và discard output về sau. Restart phục hồi từ PostgreSQL, không từ bộ nhớ. Timeout dùng AbortSignal + deadline. Phân tích/review có dependency thật; các task độc lập có thể chạy song song. Mọi task có giới hạn attempt; DAG có giới hạn node, không có loop tự sinh.

Không hứa exactly-once cho API bên ngoài không hỗ trợ idempotency. Phase 1 policy từ chối mọi effect ghi bên ngoài (publish/email/payment/delete/CMS write). Có idempotency key cho create-run/task/artifact và ledger cho future actions; future write adapter phải có remote key hoặc reconciliation, quyền và approval trước khi bật. Không dùng retry mù cho outcome không xác định.

## Approval và kiểm chứng

SEO: mock GSC → analysis → review bởi provider khác → task board → approval → report. Approval gắn checksum output + ID tác vụ, người quyết định, thời điểm; không được sửa báo cáo sau approval mà giữ approval cũ. Reject kết thúc workflow, không delivery. COMPLETED đòi hỏi toàn bộ dependency hoàn tất, output đúng schema, artifact checksum hợp lệ và approval hợp lệ. `mode=MOCK` luôn đi kèm trạng thái runtime; COMPLETED MOCK không phải kết nối thật.

## Data, credentials, ngân sách

Server lấy credential từ môi trường/secret manager tương lai; không trả giá trị qua API hoặc log. Input không được dùng làm URL provider tùy ý. API truy cập dữ liệu theo owner/workspace, download cũng kiểm tra owner. Uploaded file giới hạn size/type; blob key do server tạo, không dùng tên file làm đường dẫn.

Run có budget, reservation, cost thực tế; mỗi attempt có ledger. Claim atomically kiểm tra budget. Giá/cost của mock = 0; chi phí LIVE chưa ước tính được khi chưa có pricing/model/cap thật. Lỗi API public chỉ trả mã/thông báo đã chuẩn hóa, không dump provider error hoặc environment. Logs không chứa secret/session.

## Môi trường và giới hạn

Cần Node 24, PostgreSQL; có riêng tiến trình Next và worker. Development PostgreSQL chạy container local, volume riêng. Hạ tầng Google Cloud hiện tại chưa được xác minh, không tự suy ra free quota hoặc deploy. Phase 2/3 cần credential API thật và quyền GSC; không coi thuê bao chat là API. UI không có nút pretend-connect.

## Trade-off Phase 1 đã chọn

Giao dịch điều phối có advisory transaction lock chung để thứ tự cập nhật nhất quán ở quy mô cá nhân; task claim vẫn dùng SKIP LOCKED, công việc ngoài transaction chạy song song theo concurrency của owner. Đây chưa phải cấu hình tối ưu cho hàng nghìn worker. Khi mở rộng cần thay coordinator lock bằng lock ordering/phân vùng theo owner, giữ nguyên các kiểm thử fencing và budget.

Mọi kết nối database dùng parameterized queries; Drizzle dùng cho schema/migrations và CRUD, SQL trực tiếp chỉ cho transaction/queue cần locking rõ ràng. API trả DTO đã chọn trường, không trả blob path hay secret. Session development ký HMAC và không đặt password vào URL; cần session revocation, OIDC và distributed rate limit trước khi public.

Tool layer dùng IntegrationAdapter độc lập với ProviderAdapter, có input/output schema, scopes và healthcheck. GSC fixture là connector MOCK thực sự được gọi trong workflow; GSC thật giữ DISCONNECTED và webmasters.readonly chỉ là yêu cầu quyền tương lai, chưa được cấp. Drive/Sheets, CMS, GitHub và công cụ khác sẽ lắp vào cùng contract khi triển khai adapter.

## Cấu trúc package sau audit

| Layer                                                                                   | Nơi triển khai                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Frontend                                                                                | src/app, src/components (Next.js + React)                           |
| Backend / composition                                                                   | src/app/api, src/server/runtime.ts, src/worker.ts                   |
| Shared contracts / DTO                                                                  | @orbit/shared — packages/shared                                     |
| Goal Interpreter / Planner / DAG / Router / Executor / State / Retry / Approval / Audit | @orbit/core — packages/core                                         |
| Database / schema                                                                       | @orbit/database — packages/database                                 |
| ArtifactStore                                                                           | @orbit/storage — packages/storage                                   |
| Provider adapters                                                                       | @orbit/providers — bốn module anthropic/openai/google/xai, chỉ MOCK |
| Tool connector                                                                          | @orbit/integrations — GSC fixture MOCK                              |
| Workspace modules                                                                       | @orbit/workspaces — seo/video/research/development                  |

Các file src/core, src/db, src/providers… chỉ re-export để giữ tương thích đường import; implementation chuẩn nằm trong packages. Npm workspaces liên kết package, Next transpile các package TS. Core không import concrete provider, integration hoặc workspace; composition root lắp implementation. Có boundary tests để kiểm tra ràng buộc này.

Mỗi vendor có adapter instance, mock model ID, capabilities, health và metadata riêng. Provider mock không chứa fixture SEO; fixture thuộc workspace. Cấu hình model/enabled lưu trong provider_configs theo owner. Worker đọc cấu hình tại claim; model ngoài allowlist bị từ chối; adapter disabled không được chọn. Seed không ghi đè cấu hình người dùng. Hai adapter cũ được giữ metadata archived để không xóa history. Metadata các API thật vẫn DISCONNECTED; chưa có SDK/network adapter LIVE.

Goal Interpreter là contract-based, không tự nhận hiểu ngữ nghĩa tự do. Validation hiện xác minh schema, nguồn/checksum, dependency, phạm vi và approval; không chứng minh tính đúng đắn nghiệp vụ của fixture. Không dùng chữ COMPLETED MOCK để khẳng định AI/GSC thật đã chạy.

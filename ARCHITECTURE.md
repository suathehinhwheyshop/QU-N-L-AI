# ORBIT — kiến trúc nền tảng V1 / mở rộng Phase 2–4

## Quyết định trước khi triển khai

- Next.js 16 App Router + TypeScript, React 19, Tailwind 4: cùng kiểu dữ liệu cho UI/API, server runtime Node; giữ visual của prototype trong legacy/seo-demo. Không lấy localStorage làm database.
- PostgreSQL 17 + Drizzle: giao dịch, ràng buộc và `FOR UPDATE SKIP LOCKED` cho durable queue. Không thêm Redis/Temporal ở Phase 1: quy mô cá nhân chưa cần thêm dịch vụ, dễ kiểm tra checkpoint và khôi phục. Worker độc lập với vòng đời request/browser.
- ArtifactStore interface: content-addressed filesystem cho development, checksum + version + lineage trong PostgreSQL. Object storage GCS/S3 là adapter Phase 4, chưa tuyên bố đã triển khai.
- Auth Phase 4: admin-provisioned scrypt accounts, opaque hashed PostgreSQL sessions, idle/absolute expiry/revocation/auth_version, global roles + owner-private workspace membership, CSRF và nonce CSP. Không còn cookie HMAC/environment password cũ. Rate limits lưu PostgreSQL, không phụ thuộc memory của instance.
- Không cần API key để kiểm thử core. MOCK vẫn dùng cho automated tests. Adapter LIVE đã có code nhưng chỉ được dùng sau server credential, model/pricing, probe và data policy hợp lệ; môi trường hiện chưa xác minh API thật.

## Các lớp

`UI/API → Planner + Policy → PostgreSQL DAG → Worker → Provider/Tool registry → Validation → ArtifactStore`

Core chỉ biết contract task, schema, capability, dependency, effect và policy. Nó không import nghiệp vụ SEO. Workspace registry cung cấp template/handlers. Bốn workspace là module độc lập: SEO, Video, Research, Development. Mỗi module có template, source handler, deliverables, acceptance criteria và fixture riêng. Dùng chung engine; chưa render video hoặc thực thi code bên ngoài.

Goal Interpreter tạo contract chứa objective, deliverables, acceptance criteria của người dùng và constraints read-only và phạm vi truyền dữ liệu theo mode. Planner Phase 1 là deterministic template planner: chọn workspace/template, gắn goal/acceptance criteria, dựng DAG đã kiểm tra cycle và node budget. Chưa phải AI tự suy luận kế hoạch tùy ý. Input/output của từng handler được Zod kiểm tra. Task Router lọc capability, data policy, availability rồi chấm theo cost/latency/reliability. Bước review tránh provider vừa phân tích; không gán cố định vai trò cho hãng AI.

## Durable execution

Task claim dưới transaction và row lock SKIP LOCKED; ghi Run/Task/Attempt ID, reservation và lease trước khi gọi adapter. Không giữ transaction trong lúc gọi AI. Result commit kiểm tra attempt token và run status, ghi output, artifact, cost và event cùng giao dịch. Lease hết hạn chuyển attempt sang interrupted, bounded retry có exponential backoff. Read-only calls có thể chạy lại; kết quả cũ bị fencing chặn.

Pause ngăn nhận bước mới; bước đang chạy có thể hoàn tất checkpoint. Cancel chặn dependent tasks và discard output về sau. Restart phục hồi từ PostgreSQL, không từ bộ nhớ. Timeout dùng AbortSignal + deadline. Phân tích/review có dependency thật; các task độc lập có thể chạy song song. Mọi task có giới hạn attempt; DAG có giới hạn node, không có loop tự sinh.

Không hứa exactly-once cho API bên ngoài không hỗ trợ idempotency. Phase 1 policy từ chối mọi effect ghi bên ngoài (publish/email/payment/delete/CMS write). Có idempotency key cho create-run/task/artifact và ledger cho future actions; future write adapter phải có remote key hoặc reconciliation, quyền và approval trước khi bật. Không dùng retry mù cho outcome không xác định.

## Approval và kiểm chứng

SEO: mock GSC → analysis → review bởi provider khác → task board → approval → report. Approval gắn checksum output + ID tác vụ, người quyết định, thời điểm; không được sửa báo cáo sau approval mà giữ approval cũ. Reject kết thúc workflow, không delivery. COMPLETED đòi hỏi toàn bộ dependency hoàn tất, output đúng schema, artifact checksum hợp lệ và approval hợp lệ. `mode=MOCK` luôn đi kèm trạng thái runtime; COMPLETED MOCK không phải kết nối thật.

## Data, credentials, ngân sách

Server lấy credential từ môi trường/secret manager tương lai; không trả giá trị qua API hoặc log. Input không được dùng làm URL provider tùy ý. API truy cập dữ liệu theo owner/workspace, download cũng kiểm tra owner. Uploaded file giới hạn size/type; blob key do server tạo, không dùng tên file làm đường dẫn.

Run có budget, reservation, cost thực tế; mỗi attempt có ledger. Claim atomically kiểm tra budget. Giá/cost của mock = 0; chi phí LIVE ước tính theo pricing/model/token caps do operator cung cấp; thiếu cấu hình sẽ chặn admission. Lỗi API public chỉ trả mã/thông báo đã chuẩn hóa, không dump provider error hoặc environment. Logs không chứa secret/session.

## Môi trường và giới hạn

Cần Node 24, PostgreSQL; có riêng tiến trình Next và worker. Development PostgreSQL chạy container local, volume riêng. Hạ tầng Google Cloud hiện tại chưa được xác minh, không tự suy ra free quota hoặc deploy. Phase 2/3 cần credential API thật và quyền GSC; không coi thuê bao chat là API. UI không có nút pretend-connect.

## Trade-off Phase 1 đã chọn

Giao dịch điều phối có advisory transaction lock chung để thứ tự cập nhật nhất quán ở quy mô cá nhân; task claim vẫn dùng SKIP LOCKED, công việc ngoài transaction chạy song song theo concurrency của owner. Đây chưa phải cấu hình tối ưu cho hàng nghìn worker. Khi mở rộng cần thay coordinator lock bằng lock ordering/phân vùng theo owner, giữ nguyên các kiểm thử fencing và budget.

Mọi kết nối database dùng parameterized queries; Drizzle dùng cho schema/migrations và CRUD, SQL trực tiếp chỉ cho transaction/queue cần locking rõ ràng. API trả DTO đã chọn trường, không trả blob path hay secret. Session opaque có revocation/expiry; OIDC/MFA chưa triển khai. Public deployment phải qua host/domain/TLS/operations gates riêng.

Tool layer dùng IntegrationAdapter độc lập với ProviderAdapter, có input/output schema, scopes và healthcheck. GSC fixture là connector MOCK thực sự được gọi trong workflow; GSC OAuth read-only đã có implementation Phase 3; credential/grant thật vẫn chưa được cấp trong môi trường này. Drive/Sheets, CMS, GitHub và công cụ khác sẽ lắp vào cùng contract khi triển khai adapter.

## Cấu trúc package sau audit

| Layer                                                                                   | Nơi triển khai                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frontend                                                                                | src/app, src/components (Next.js + React)                                                |
| Backend / composition                                                                   | src/app/api, src/server/runtime.ts, src/worker.ts                                        |
| Shared contracts / DTO                                                                  | @orbit/shared — packages/shared                                                          |
| Goal Interpreter / Planner / DAG / Router / Executor / State / Retry / Approval / Audit | @orbit/core — packages/core                                                              |
| Database / schema                                                                       | @orbit/database — packages/database                                                      |
| ArtifactStore                                                                           | @orbit/storage — packages/storage                                                        |
| Provider adapters                                                                       | @orbit/providers — bốn module anthropic/openai/google/xai, mock và REST network adapters |
| Tool connector                                                                          | @orbit/integrations — GSC fixture + OAuth read-only/data services                        |
| Workspace modules                                                                       | @orbit/workspaces — seo/video/research/development                                       |

Các file src/core, src/db, src/providers… chỉ re-export để giữ tương thích đường import; implementation chuẩn nằm trong packages. Npm workspaces liên kết package, Next transpile các package TS. Core không import concrete provider, integration hoặc workspace; composition root lắp implementation. Có boundary tests để kiểm tra ràng buộc này.

Mỗi vendor có adapter instance, mock model ID, capabilities, health và metadata riêng. Provider mock không chứa fixture SEO; fixture thuộc workspace. Cấu hình model/enabled lưu trong provider_configs theo owner. Worker đọc cấu hình tại claim; model ngoài allowlist bị từ chối; adapter disabled không được chọn. Seed không ghi đè cấu hình người dùng. Hai adapter cũ được giữ metadata archived để không xóa history. Metadata API thật được dẫn xuất theo owner từ receipts. Không lấy cột trạng thái tĩnh làm bằng chứng; network adapters được mô tả bên dưới.

Template Goal Interpreter là contract-based; AI planning bổ sung có giới hạn, không sinh DAG/quyền tự do. Validation hiện xác minh schema, nguồn/checksum, dependency, phạm vi và approval; không chứng minh tính đúng đắn nghiệp vụ của fixture. Không dùng chữ COMPLETED MOCK để khẳng định AI/GSC thật đã chạy.

## Phase 2 — adapter, planning và admission

Giữ nguyên bảy packages và coordinator/DAG/lease/checkpoint/approval. Adapter độc lập thực hiện một HTTP request theo giao thức của hãng, không SDK retries và không phụ thuộc Claude Code. `@orbit/providers` sở hữu wire/build/parse, proxy-aware transport, schema JSON, normalized usage và provenance. Core chỉ nhận ProviderAdapter contract.

`MOCK`, `HTTP_STUB`, `LIVE_API` là loại bằng chứng, độc lập với trạng thái COMPLETED. Stub adapters có mode MOCK và ID `stub-*`. Transport chính thức cố định HTTPS endpoint trong code; client không cấp endpoint hoặc key. Provider health không tự trả CONNECTED. Probe server thực hiện inference JSON, ghi config hash + credential HMAC tag, selected/returned model, request ID khi hãng cung cấp, latency, usage/cost và kết quả. Không lưu credential gốc. HMAC tag và attempt snapshot không trả về UI.

Router đọc config theo owner: enabled, capability, probe còn hiệu lực 15 phút, cấu hình và credential trùng, không chỉ dựa vào tên hãng. Sau khi lọc mode/policy/availability và budget, ưu tiên điểm cost/latency/reliability; latency lấy từ probe, reliability hiện là hằng số, chưa đo tỷ lệ thành công lịch sử. Review tránh vendor của analyst qua ID provider chính thức. Các model phải hỗ trợ giao thức structured JSON/tools hiện triển khai; probe không chứng minh trước mọi kết quả nghiệp vụ, output mỗi task vẫn phải qua Zod và checksum.

LIVE admission yêu cầu external policy + consent theo goal + ít nhất hai provider độc lập đã probe. Price và token caps bắt buộc. Claim lưu snapshot pricing/credential trước network call để thay config sau claim không đổi hóa đơn ước tính của attempt. Không giữ DB transaction lúc gọi HTTP. Thành công/invalid output/cancel đều giữ chi phí đã ghi nhận. Timeout/network error/HTTP 5xx hoặc expired LIVE lease có outcome không xác định: tiêu reservation bảo thủ, không hoàn ngân sách rồi retry vô hạn. Probe crashed được settle khi probe tiếp theo tới. Run reservation và ledger probe riêng được kiểm soát atomically. Đây là local spending guard theo giá khai báo, không thay provider spending limit.

AI planning là task `interpret` bền vững giữa source và analysis, có reservation, timeout, usage, checkpoint và artifact. Preview vẫn deterministic, không gọi tính phí. AI phải trả ProposedPlan strict (objective, acceptance criteria, đúng năm bước, dependencies và effect read); validator giữ nguyên objective/criteria bắt buộc và topology/approval. Instructions hợp lệ được truyền sang analyst/reviewer; handler/tool/model quyền thực thi vẫn do template và router chọn. Đây là **bounded AI planning trong template đã duyệt**, chưa phải tự sinh workflow tùy ý. Sai schema/quyền hoặc không có planning provider trả TEMPLATE_FALLBACK cùng lý do, không báo AI thành công. Deadline invoke 30 giây nằm trong deadline task LIVE 60 giây để còn thời gian lưu fallback.

Research/Video/Development LIVE nhận ContextData nguồn USER_INPUT. SEO LIVE chỉ nhận dataset ID đã kiểm tra owner/checksum; không chuyển fixture thành LIVE. Legacy upload giữ bytes/metadata; SEO CSV/JSON import là đường parse dữ liệu riêng trong Phase 3.

Probes chỉ ra đường gọi API đã trả JSON hợp lệ; bằng chứng thực tế từ multi-step worker vẫn cần run/attempt/usage/artifact thực. Môi trường hiện thiếu keys, `verify:live` ghi BLOCKED. Bản draft môi trường thêm đúng bốn API hosts và secret requirements; chưa được publish/apply, không coi là runtime access đã có.

## Phase 3 — GSC và evidence-first SEO

GSC client/OAuth/crypto/immutable dataset services thuộc @orbit/integrations; metrics/AI schemas/template/validation/synthesis thuộc @orbit/workspaces với contracts @orbit/shared. Vẫn 7 packages; engine không import concrete integration/workspace. Workspace goal-policy hook xác minh quyền dataset trước preview/create. HandlerContext thêm execution IDs phục vụ owner access và checkpoint fence; core thêm Retry-After và optional artifact renderer, giữ queue/DAG/lease/approval hiện có.

GSC ingestion là một tool task của engine, không queue riêng. gsc_jobs liên kết run + spec + checkpoint pages/cursor + dataset ID. Mỗi page lưu canonical normalized envelope vào ArtifactStore rồi commit checkpoint dưới coordinator/attempt fence; HTTP ở ngoài transaction. Restart/retry đọc lại pages, tiếp tục startRow; stale attempt không commit. Immutable dataset unique theo owner/request key và job, idempotent finalization. Thu thập source có thể chạy mà không AI keys; run.mode mô tả AI inference, dataset.provenance.kind mô tả nguồn riêng.

OAuth start là POST authenticated/Origin-checked, state hash/browser nonce và encrypted PKCE verifier, TTL/one-use DB. Cookie OAuth Lax cho callback; app session vẫn Strict. Tokens AES-256-GCM/AAD theo owner và purpose, key riêng. Row lock serialized refresh; 401 chỉ refresh/retry một lần; read-only scope, fixed official endpoints và proxy/TLS. Revoke pending deny reads và retry; encrypted token version mới không bị revoke finalization cũ xóa nhầm. No raw token/client secret trong DTO/events/artifacts.

Nguồn có spec/date/filter/timezone/capture/source hashes và warning. API không bảo đảm mọi query; normalized sums không phải property totals. Imported CSV/JSON chỉ USER_SUPPLIED. Facts giữ top 20 evidence IDs + deterministic measurements; AI chọn action/reason/priority theo enum và fact ID, không numeric/free prose output. Review khác provider; validation recompute facts/checksum từ dataset immutable trước synthesis. Bước board bind facts/dataset/source hashes cùng metrics/criteria; approval hash bảo vệ toàn board.

Delivery renderer tạo MD/CSV/JSON và JSON checkpoint của task; blobs put trước transaction, metadata commit cùng completed attempt, source lineage và cost. Cancel/fencing discard metadata, không phát hành report. Orphan cleanup Phase 4 dry-run mặc định, chỉ xóa orphan quá 7 ngày trong maintenance; references gồm raw datasets và GSC checkpoint pages. Trusted server composition port cho GscClient cho phép E2E preload cài HTTP_STUB; không có client/env endpoint override và stub không mang kind GSC_API.

OAuth/GSC/AI LIVE phải kiểm chứng riêng. Code + HTTP_STUB passes chưa xác nhận tài khoản Google, property entitlement hoặc AI billing. Phase 4 bổ sung sessions/RBAC, local TLS staging, backup/restore/rotation và monitoring commands. OIDC/MFA, KMS/object storage, offsite recovery, external alerts và public deployment chưa nghiệm thu.

## Phase 4 deployment boundary

`Caddy HTTPS → Next API → PostgreSQL durable DAG ← worker`; migrator/grants/provision là one-off privileged roles, web/worker credentials tách biệt. Compose private network cho DB, loopback ingress mặc định, immutable non-root/read-only images, persistent DB/artifact volumes. Worker heartbeat/readiness và graceful drain bổ sung mà không thay queue hay state machine. 50 workflows chưa kết thúc/owner được enforce cùng transaction tạo run; idempotent replay đi trước quota.

GSC token rotation đọc active+previous, ghi active, transaction rewrap + invalidate OAuth states; backup key độc lập. Backup service pg_dump trước artifacts, AES-GCM archive trong persistent backup volume, scheduler 24h/keep7, OS flock chống trùng và crash lock. Restore authenticate/checksum trước tạo DB, chỉ target mới, verify blobs, revoke sessions và pause in-flight runs. Chưa offsite/cloud storage. Chi tiết triển khai và threat model trong docs/SECURITY.md, DEPLOYMENT.md, BACKUP_RECOVERY.md và OPERATIONS.md.

## Local/subscription boundary hiện tại

Quyết định mới: Windows 10/WSL2, single owner, 127.0.0.1, không public/cloud/paid REST. Web/worker native cùng WSL user để dùng official CLI profiles riêng; PG/backup qua Docker Desktop. Startup pause và single-worker lease giữ dữ liệu nhưng không tự Resume. CLI adapter độc lập trong package providers, process runner bounded/cancelable và schema outputs; core chỉ mở rộng evidence kind/CLI lease/quota pause, không đổi DAG/state storage. Local Mode chặn paid REST ở registry/probe/transport. Claude eligibility BLOCKED, Grok UNSUPPORTED; Codex/Gemini LIVE và Windows acceptance chưa verified. Xem docs/SUBSCRIPTION_AI_INTEGRATION.md, LOCAL_SETUP_WINDOWS.md và LOCAL_SUBSCRIPTION_VALIDATION.md.

## Provider correction boundary

Product configuration now prefers Claude Max5x/ChatGPT/Grokbot. Optional Gemini is disabled before registration/probe/install/invoke; the generic router still uses capability, availability, vendor and policy. Codex included-only enforcement is UNVERIFIED, so live prompt execution stays fail-closed. Claude/Grokbot have no runtime adapters without eligibility. Codex instance marker separates port3211/PG55435/project/volume/profile/build/cookie names; legacy instances keep prior behavior. Separate Codex checkout is required for source/node_modules isolation. No schema or DAG rewrite. See docs/PROVIDER_CORRECTION_VALIDATION.md.

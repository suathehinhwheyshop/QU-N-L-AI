# ORBIT — bốn giai đoạn

## Ưu tiên hiện tại — Windows localhost, subscription-only

Local Mode + Windows/WSL2 scripts, official Codex/Gemini CLI adapters và engine handoff đã triển khai. Đang phân biệt Linux/CLI_STUB evidence với Windows và AI LIVE chưa có login/consent. Claude Code BLOCKED eligibility, Grok UNSUPPORTED. Không cần public hosting/domain/Google Cloud hoặc paid REST API. Báo cáo Phase 1–4 bên dưới giữ lịch sử; các public/REST gates cũ không phải điều kiện của local release. Xem docs/LOCAL_SUBSCRIPTION_VALIDATION.md.

## Phase 1 — Foundation

Đã nghiệm thu lại ở `9f07558`: 7 packages, 4 workspace modules, mock providers, durable DAG/leases/checkpoints/retry/controls/budgets, validation, approval, artifacts và audit. Toàn bộ regression được giữ trong Phase 2–3; không lấy HTML demo làm bằng chứng.

## Phase 2 — Real Multi-AI implementation; LIVE BLOCKED

Parent `b6bb1fc` đã xác minh lại: 19 unit, 19 integration, typecheck/build và E2E PASS. Bốn REST adapters độc lập, server credentials, model/pricing/probes, capability/cost/latency/availability routing, structured handoff, usage và bounded AI planning/fallback. Không phụ thuộc Claude Code. Chưa có ít nhất hai API credentials/quota/model probes thật; không đánh dấu LIVE từ HTTP stub.

## Phase 3 — GSC/SEO CODE COMPLETE + HTTP_STUB TESTED; LIVE BLOCKED

GSC OAuth read-only/PKCE/token encryption/refresh/revoke; property discovery/Search Analytics/pagination/rate limits; source/checksum/date/filter warnings và CSV/JSON imports. Dùng lại engine cho ingestion/checkpoint, không queue mới. AI1 → AI2 khác provider → code validation → synthesis/board → human approval → MD/CSV/JSON. Deterministic facts không cho AI tự tạo số liệu. SEO UI/backend đã nối, desktop/mobile 390 px được kiểm tra.

Đã chạy 25 unit, 31 integration (giữ 19 regression Phase 1–2), typecheck/build, E2E OAuth HTTP_STUB/app+worker restart và browser 11 nhóm/9 views. Xem docs/PHASE3_VALIDATION.md và evidence summary. Không tự sửa website, không paid calls trong lượt này.

Chưa nghiệm thu LIVE:

1. Cấu hình Google OAuth web client, redirect, consent testing user và property read grant; review/save/publish environment draft, kiểm tra runtime đã apply; restart web/worker cùng encryption key.
2. Lấy dataset official qua worker và kiểm chứng source pages/hash/history bằng `verify:gsc -- --dataset=<id>`. Import/HTTP_STUB không được nâng thành GSC_API.
3. Ít nhất hai AI API credentials/quota/model/pricing/probes thật, data policy + consent và quyền paid calls riêng. Chạy SEO qua hai API, kiểm tra usage/evidence, human approval và final reports.
4. Lưu chứng cứ GSC và AI riêng, rồi mới ghi nhận nghiệm thu Phase 3 LIVE.

## Phase 4 — secure local staging verified; public/production gates còn thiếu

Đã có real accounts/sessions/RBAC, CSRF/CSP/HTTPS, Docker web/worker/PostgreSQL, migration/grants/readiness/persistence, scheduled encrypted backups + fresh-target restore, key rotation, artifact retention, safe request/execution logs và operations/rollback runbooks. CI gates chuẩn bị, chưa chứng minh chạy remote. Không cần LIVE credentials để triển khai các phần độc lập này theo yêu cầu Phase 4 continuation.

Local HTTPS login → MOCK SEO → approval/reports → restart → desktop/mobile được kiểm thử. Public chưa deploy; cần lựa chọn hosting/domain/budget và quyền mở Internet. Production còn offsite/fresh-host recovery, external alert delivery, host/IAM/OS image review và nghiệm thu GSC/AI LIVE riêng. Không mở website write/publish.

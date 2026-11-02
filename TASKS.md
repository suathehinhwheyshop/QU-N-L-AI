# ORBIT — checklist triển khai

## Foundation được giữ

- [x] Xác minh parent branch/commit `orbit/phase1-foundation-audit` / `9f07558` và code hoạt động, không HTML demo.
- [x] Chạy baseline: 14 unit, 10 integration, typecheck/build, backend/worker/database E2E.
- [x] Giữ 7 packages, 4 workspace modules, mock providers và mọi acceptance tests Phase 1.
- [x] Regression controls, retry/timeout, fencing/recovery, idempotency/budgets, approval, artifacts và restart app/worker.

## Phase 2 — đã triển khai code

- [x] Bốn REST wires độc lập: Anthropic Messages, OpenAI Chat Completions, Google generateContent, xAI Chat Completions.
- [x] Giữ mock adapters và HTTP_STUB tests mang nhãn riêng, không Connected/LIVE giả.
- [x] Server environment secrets, official HTTPS endpoints cố định, proxy/CA verification, lỗi chuẩn hóa/redaction, không retry ngầm.
- [x] Model/pricing/token caps config thực trong backend/UI; không bịa giá hoặc quyền API.
- [x] Provider probes và receipts bền vững; readiness theo owner, TTL/config/credential binding; chặn stub/expired/failed.
- [x] LIVE admission cần hai providers, data policy/consent; routing theo capability/cost/latency/availability.
- [x] Usage/evidence và giá snapshot theo attempt; giữ chi phí khi invalid output/cancel, tính reservation bảo thủ cho lỗi billable không chắc chắn.
- [x] Probe ledger, budget guard/serialization, giới hạn tần suất và crash settlement.
- [x] AI Goal Interpreter/planning task có schema, quyền read-only, giữ objective/criteria/dependencies/approval, template fallback có lý do.
- [x] Không gọi AI tính phí từ preview; source MOCK không được coi là LIVE; GSC thật để Phase 3.
- [x] Migrations 0002/0003 additive, seed giữ run và owner configs; 14 bảng.
- [x] 19 unit/protocol + 19 PostgreSQL integration tests; production build/typecheck; E2E Foundation và AI planning MOCK qua worker/database.
- [x] Browser regression 10 nhóm, mobile 390 px; không runtime exceptions.
- [x] `verify:live` và evidence BLOCKED khi thiếu prerequisites; không tự approve trong script.
- [x] README, architecture/schema/roadmap/tasks, preflight, provider protocol docs và validation evidence.

## Phase 2 — chưa nghiệm thu LIVE

- [ ] Secure credentials cho ít nhất hai AI APIs, quota/model entitlement thực.
- [ ] Review/save/publish environment draft, kiểm tra egress/runtime đã apply và restart processes.
- [ ] Model/pricing đã xác nhận và hai inference probes API chính thức.
- [ ] Structured handoff thật giữa ít nhất hai providers qua backend/worker/database.
- [ ] Human approval và final artifact thật; lưu receipts/usage/cost/errors và bằng chứng nghiệm thu.

Không merge main. Branch làm việc: `orbit/phase2-real-multi-ai`. Commit/push được xác nhận qua Git khi bàn giao, không ghi một SHA dự đoán.

Phase 3 GSC thật và Phase 4 production hardening chưa triển khai.

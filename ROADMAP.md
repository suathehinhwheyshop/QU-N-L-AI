# ORBIT — bốn giai đoạn

## Phase 1 — Foundation, giữ nguyên nghiệm thu

Baseline `orbit/phase1-foundation-audit` / `9f07558` đã được xác minh và chạy lại: 14 unit, 10 PostgreSQL integration, typecheck/build, E2E restart app/worker đều PASS. Có 7 shared packages, 4 workspace modules, mock providers, durable DAG/lease/checkpoint, routing, schema validation, budgets, retries, controls, approval, artifact và audit. Mọi regression vẫn nằm trong bộ kiểm thử Phase 2.

## Phase 2 — Real multi-AI execution, code có sẵn; LIVE chưa nghiệm thu

Đã triển khai bốn REST adapters Anthropic/OpenAI/Gemini/xAI độc lập, server-only credentials, model/pricing configuration, structured inference probe và provenance, route theo capability/cost/latency/availability, structured handoff, usage/accounting và bounded AI planning/fallback. Engine/7 packages được giữ. Offline unit/HTTP_STUB/integration và E2E qua worker/database đã chạy; xem docs/PHASE2_VALIDATION.md.

Còn chặn nghiệm thu thật:

1. Cấp API credentials có quota/quyền cho ít nhất hai provider, bật đúng bốn egress hosts cần dùng trong environment settings rồi restart web/worker. Draft lưu chưa tương đương runtime đã apply/publish.
2. Cấu hình model ID, giá và token caps theo quyền API thực tế; xác nhận external data policy/consent. Probe thật phải thành công, receipts không hết hạn.
3. Chạy `npm run verify:live -- --execute`, kiểm tra hai nhà cung cấp trả structured outputs qua worker/database. Không coi HTTP stub là LIVE.
4. Người dùng duyệt run theo checksum trong UI, kiểm tra final artifact/download, usage, logs và giới hạn chi phí. Lưu bằng chứng thật rồi mới công bố nghiệm thu Phase 2.

AI chỉ lập kế hoạch trong topology read-only đã duyệt. Chưa sinh arbitrary DAG, không công cụ ghi/remote execution. Research/Video/Development LIVE dùng USER_INPUT, chưa đọc nguồn bên ngoài. SEO LIVE bị chặn đến Phase 3. Không tích hợp codebase Claude Code.

## Phase 3 — Real workflow, chưa triển khai

GSC read-only OAuth/service account theo property, pagination/filters/date range, provenance/source integrity; hai AI phân tích/review, task board, human approval, report/history. Cần quyền GSC và Phase 2 LIVE đã nghiệm thu. Không sửa CMS trong MVP.

## Phase 4 — Production hardening, chưa triển khai

OIDC, authorization/security review, distributed rate limits, secret manager, monitoring/alerting, recovery drills, object storage, backup/restore, deployment/quota Google Cloud. Không deploy public bản auth development. CMS write là mở rộng riêng có quyền thực thi, approval, before/after và rollback/reconciliation.

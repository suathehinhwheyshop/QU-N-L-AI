# ORBIT — bốn giai đoạn

## Phase 1 — Foundation (nghiệm thu lại sau audit)

Npm shared packages, Goal Interpreter theo contract, bốn workspace module và bốn vendor mock adapters; Next.js/TS/Tailwind, schema và migration PostgreSQL/Drizzle; API và UI có lưu backend; workspace/template registry; DAG validation, routing, durable worker, attempts/leases, pause/resume/cancel, bounded retry, budgets, schema validation, approval, versioned artifacts và audit. Mock adapters để kiểm thử kiến trúc; không sửa website. Unit + PostgreSQL integration + E2E UI.

Đạt khi một run MOCK đi từ goal đến approval và report có artifact thật; worker restart tiếp tục được, claim cạnh tranh không tạo attempt trùng, timeout/retry bị giới hạn, cancel/reject không xuất report, không có nút giả.

## Phase 2 — Real AI

Ít nhất hai adapter chính thức, server-side credentials, model capability/pricing configuration, API healthcheck thật, structured handoff, usage accounting và data policy. Chỉ bật LIVE khi đủ prerequisites. Blocker hiện tại: chưa có API credentials và model/API entitlement được xác minh. Không yêu cầu secret trong chat.

## Phase 3 — Real workflow

GSC read-only OAuth/service account theo quyền property, pagination, filters, source integrity; hai AI phân tích/review; bảng việc và approval; report/history. Kiểm chứng với dữ liệu thật cùng filter. Blocker: quyền GSC và hai provider thật. MVP không sửa CMS.

## Phase 4 — Production hardening

OIDC, authorization review, distributed rate limits, secret manager, observability/alerting, recovery drills, object storage, backup/restore, deployment và quota thực tế Google Cloud. Không deploy public bản local-dev auth. CMS write là mở rộng riêng: explicit permissions, approval, before/after và rollback/reconciliation.

Không thực thi Phase 2/3 trong lượt audit này. Chỉ metadata/cấu hình MOCK được bổ sung. Bước tiếp theo sau nghiệm thu: triển khai ít nhất hai adapter API thật, thiết lập secret trên server, kiểm tra quyền API/model, structured handoff, usage/pricing và đánh dấu CONNECTED chỉ sau probe thật. Quyền GSC thuộc Phase 3, không phải prerequisite của Foundation.

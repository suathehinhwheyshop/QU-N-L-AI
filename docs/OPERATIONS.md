# Vận hành và rollback ORBIT

## Readiness, logs, alerts

- `/api/health/live` chỉ kiểm tra process; `/api/health/ready` kiểm DB, exact migration count, active provisioned admin và worker heartbeat mới. Chỉ trả UP/READY hoặc 503, không dump config. Readiness toàn app không xác minh external APIs.
- Web/worker/TLS/PostgreSQL/backup có restart policy; readiness/backup health giúp phát hiện lỗi, Compose không tự restart chỉ vì unhealthy. Operator cần monitor/restart sau điều tra. Worker SIGTERM dừng claim mới, drain tác vụ và ghi STOPPED, grace 150 giây. Forced kill phục hồi qua lease/attempt fencing, không reset database. Side effects website chưa tồn tại.
- `docker compose logs --since=15m web worker backup` cho structured logs. `X-Request-ID` trả cho mỗi request API/GSC; đối chiếu HTTP duration/status, worker ID và Run/Task/Attempt IDs trong persisted workflow events. Đây là request/execution correlation, chưa có OpenTelemetry collector/distributed spans hoặc metrics dashboard cloud.
- ADMIN-only `GET /api/admin/metrics` trả trạng thái runs của owner và worker freshness; không chứa secrets. `docker compose run --rm provision monitor` trả alerts JSON + exit nonzero khi worker stale, recent failed runs hoặc lease quá hạn; kết hợp backup `health` và Docker service health vào cron/system monitor của host. Chưa gửi email/Slack/webhook hoặc nghiệm thu external alert delivery.
- Rate limits/quota ở PostgreSQL dùng chung mọi instance. Workflow max 50 chưa kết thúc/owner, concurrency do Settings, ngân sách/reservations/uncertain charge theo Phase 2. API inference retry vẫn có thể phát sinh phí; không hứa exactly-once khi hãng không hỗ trợ.

## Lỗi thường gặp

Readiness 503: kiểm migrate/grants exit status, provision account thật (không seed), worker logs/heartbeat, cùng DB và artifact volume. OAuth/API unconfigured hiển thị BLOCKED là đúng. Key/token decrypt lỗi: không xóa row hoặc regenerate key; kiểm tra file secrets và lịch rotation. App DB permissions lỗi: chạy grants từ image tương ứng, không cấp superuser cho web/worker. PostgreSQL/volume đầy: dừng ingest, backup kiểm chứng và tăng disk; không `down -v` hoặc xóa referenced artifacts.

Healthcheck timeouts không đồng nghĩa workflow đã FAILED; xem persisted attempts/checkpoints trước retry. UI Pause chặn bước mới, đang chạy có thể hoàn tất; Cancel ngăn commit output về sau. Forced restart có thể lặp read-only API/inference; ledger giữ cost bảo thủ và bounded retry.

## Update và recovery

1. Ghi version/image digest + schema journal count + config backup, tạo encrypted backup và restore drill. Bảo vệ token/backup keys riêng.
2. Dừng web/worker; migrate rồi grants trước serve. Không ghi migration cũ, không reset seed trên staging. Snapshot Phase 3→0005 đã kiểm tra in-place và repeatable.
3. Deploy image bất biến, start services, check readiness/login/CSRF/RBAC/MOCK approval/report. Nếu chưa đủ quyền external, không probe API trả phí.
4. App rollback dùng digest cũ chỉ khi schema tương thích. Restore DB vào target mới nếu migration không tương thích; cutover DB/storage cùng một backup version, revoke sessions, giữ runs paused, đối chiếu approval hashes/artifacts trước resume. Không merge main tự động, CI không publish images/deploy.

## Phần còn lại trước production

Public host/domain/DNS/TLS ACME và network hardening thực tế; backup offsite + fresh-host restore/RPO-RTO đo trên dữ liệu thật; independent security review/OS image CVE scan; alert sink và vận hành định kỳ. SSO/MFA/self-service account recovery, object storage cloud và multi-owner workspace sharing chưa triển khai. GSC và hai AI LIVE phải nghiệm thu riêng với credentials/quota và quyền paid calls. Chưa có write/publish CMS hoặc quyền tự sửa website.

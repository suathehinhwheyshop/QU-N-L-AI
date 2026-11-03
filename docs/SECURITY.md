# Bảo mật Phase 4

## Các giới hạn thực thi

Auth thật: account do admin cấp, salted scrypt N=32768/r=8/p=1, mật khẩu 16–512 ký tự; không public signup hay environment-password backdoor. Session opaque 256-bit chỉ lưu SHA-256 trong PostgreSQL, HttpOnly/Secure/SameSite=Strict khi staging, idle 30 phút/absolute 8 giờ. Login mới thay session; logout/password reset/account inactive/auth_version vô hiệu hóa phiên phía server. Cookie HMAC Phase 3 bị từ chối.

Server RBAC global ADMIN/OPERATOR/VIEWER, membership workspace ADMIN/EDITOR/VIEWER. ADMIN quản lý connection/settings/approval; OPERATOR chạy task; VIEWER chỉ đọc. Quyền global và workspace cùng phải hợp lệ. Workspaces hiện owner-private: membership chưa mở chia sẻ giữa owners. API/list/download lọc owner+membership, worker không claim task khi owner/membership mất quyền. Không có worker-control HTTP endpoint. Quản trị user vẫn là CLI, không UI admin.

CSRF: mutations yêu cầu Origin đúng cấu hình và chặn Sec-Fetch-Site=cross-site; JSON/file body bounded. OAuth callback GET dùng PKCE/state/browser nonce một lần, TTL và session hash đã bắt đầu luồng; kiểm tra session active/auth_version/role/membership trước token exchange. SameSite=Lax chỉ cho OAuth nonce, app session vẫn Strict.

CSP nonce từng request, strict-dynamic, object/frame/base denied; không unsafe-eval production. Inline style vẫn được phép cho layout hiện có. HSTS ở reverse proxy, no-referrer và permission policy; artifact download kiểm tra owner/membership, filename server-controlled, checksum trước trả bytes. SQL parameterized; SQL admin dùng identifiers/roles allowlist, không dữ liệu từ AI.

Secrets server-only: Docker secret files hoặc environment private, không NEXT_PUBLIC. GSC AES-256-GCM random IV + owner/purpose AAD. Key rotation dual-key read/active-only write, rewrap transaction; xem runbook. API keys thay file và recreate web/worker, probe cũ mất binding. Session secret rotation không tự thu hồi opaque DB sessions; dùng auth_version/revoke hoặc TRUNCATE auth_sessions qua maintenance. Session secret vẫn giữ cho provider credential fingerprint binding.

Web và worker non-root/read-only filesystem/cap_drop/no-new-privileges, DB không public port; app/worker DB roles không tạo roles/databases/principals. Worker không đọc password hashes/session/rate limit/OAuth state/security event tables. Migrator/provision/backup dùng privileged DB secret trong service riêng, không mount vào web/worker. Compose secrets là files, không phải managed KMS; root/host administrator vẫn có thể đọc, disk/backups cần bảo vệ ngoài ứng dụng.

## Audit phạm vi và bằng chứng

- SSRF: official fixed provider/GSC endpoints, không endpoint override HTTP; dataset URL không được fetch, chỉ xử lý như data. Test từ chối metadata IP override. Không có CMS/browser arbitrary network tool.
- Prompt injection: bounded schema DAG/handler/effect/capability allowlists, read-only policy và template fallback; SEO AI chỉ fact IDs/enums, không số liệu tự tạo. Không coi model output là quyền thực thi. Model validation và malicious plan tests Phase 2–3 được giữ.
- Session fixation/replay/expiry/logout/password reset, cross-owner access, permission downgrade, revoked OAuth flow, CSRF và TLS cookies đã kiểm thử; security tests dùng PostgreSQL và staging HTTPS thật.
- Giới hạn: 10 login/account/10 phút, 60 login/client/phút; authenticated API 900/user/phút. IP chỉ tin header do Caddy ghi đè. 50 workflows chưa kết thúc/owner, owner concurrency và run budgets/probe ledger vẫn được enforce atomically. Không có tổng ngân sách AI theo tổ chức hoặc hóa đơn hãng; giá do operator cung cấp.
- Request logs chỉ request ID, group, method, status và duration, không URL query/body/cookies/auth headers. Worker logs có worker ID; execution events có Run/Task/Attempt IDs. API errors sanitized, DB idle errors không dump connection config.
- `security:check` kiểm tra secret patterns và client readers; npm audit production dependencies là gate. Đây là kiểm tra tập trung của dự án, chưa phải penetration test hoặc independent audit. Chưa scan CVE toàn bộ OS image, chưa nghiệm thu Internet/ACME, IAM/firewall thực tế, MFA/SSO hay external alert delivery.

Trạng thái: LOCAL HTTPS STAGING VERIFIED; public staging chưa deploy; PRODUCTION READY chưa được chứng minh. GSC LIVE/AI LIVE BLOCKED không được đổi thành Connected bởi HTTP_STUB.

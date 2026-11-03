# Phase 4 — validation và bàn giao

Baseline xác minh `orbit/phase3-gsc-seo-workflow`, full HEAD `1def13be3d90c5df7c339d944fdb37197abee27f`, working tree ban đầu sạch. Branch triển khai `orbit/phase4-secure-staging`, không merge main. Baseline Phase 3 chạy lại trước sửa: 25 unit, 31 integration, typecheck/build/E2E/browser PASS, giữ riêng trong `docs/evidence/phase3-baseline/`. Bảy packages, durable engine và giao diện hiện có được kế thừa; không copy/phụ thuộc Claude Code.

## Trạng thái nghiệm thu

| Phạm vi                        | Kết quả                                        | Bằng chứng/giới hạn                                                                                                                                            |
| ------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone A — CODE COMPLETE    | Có                                             | Auth/RBAC, Docker web/worker/PG/TLS, migration/grants, persistence/health/restart, CI gates, local staging workflow                                            |
| Milestone A — STAGING VERIFIED | Local HTTPS                                    | Production build, CA được tin thực sự, backend/worker/database thật, browser desktop/mobile 390 px; `phase4-staging.json`                                      |
| Public staging                 | BLOCKED — chưa deploy                          | Không host/domain/quyền mở Internet; không có public staging URL                                                                                               |
| Milestone B                    | Đã triển khai phần local; còn production gates | Rotation, encrypted scheduled backup/real restore, retention/integrity, worker recovery, metrics/logs/checks/quota; offsite/host/alerts/review chưa nghiệm thu |
| PRODUCTION READY               | Chưa chứng minh                                | Không suy ra từ local staging; điều kiện còn thiếu bên dưới                                                                                                    |
| GSC LIVE / AI LIVE             | BLOCKED                                        | Thiếu credentials/property/API grants; không paid API calls, không đổi HTTP_STUB thành LIVE                                                                    |

Không tạo tài nguyên cloud tính phí, không mở public ports, không triển khai Internet, không sửa hoặc xuất bản website. Local ingress chỉ loopback. CI workflow không deploy hoặc publish image.

## Code thực sự được triển khai

- Password accounts admin-provisioned (scrypt), không mặc định demo account/backdoor từ ORBIT_ADMIN_PASSWORD. CLI tạo/reset/adopt Phase 3 owner giữ nguyên UUID/data. DB opaque sessions hash-only, expiry idle/absolute, logout/revocation/password reset/auth_version và inactive checks.
- Server roles và owner-private workspace membership; quản lý connection/settings/approvals bị chặn theo quyền; run/artifact owner isolation. Worker claim kiểm tra quyền owner/workspace. OAuth state bind session, callback từ phiên revoked bị chặn trước trao đổi token.
- Secure/HttpOnly/Strict cookies, Origin/Fetch-Metadata CSRF, bounded JSON/file input, nonce CSP/HSTS/no-referrer. Login/API rate limits persistent PostgreSQL; queue quota 50 workflow chưa kết thúc, concurrency/budget reservations giữ logic Phase 2.
- Non-root/read-only Docker images, web/worker/migrator/provision/grants/backup tách process và credential; DB không mở port. Worker DB role không đọc password hashes, sessions hoặc OAuth states. Migration trước serve, persistent DB/artifacts/TLS/backup volumes, health/readiness/heartbeat/restart, SIGTERM drain. Không thay queue/DAG engine.
- GSC encryption dual-key read/active-only write và transactional rewrap CLI; corrupt ciphertext rollback. API keys server file/env; optional integration mount riêng, không bắt nhập keys để dùng MOCK.
- Backup service thực thi pg_dump PostgreSQL 17 và artifact snapshot, AES-256-GCM archive với checksum/AAD/tag, lịch 24 giờ/keep7/retry/health, OS flock chống backup trùng và crash lock. Restore authenticate trước tạo target mới, kiểm blob hashes, xóa sessions/OAuth states, pause queued/running runs. Local backup cùng VM chưa phải disaster recovery.
- Artifact content-addressing/checksum/access controls kế thừa; retention mới giữ mọi referenced report/dataset/raw/page checkpoint, dry-run mặc định và maintenance guard trước xóa orphan quá 7 ngày.
- Safe request IDs/duration/status logs, persisted Run/Task/Attempt audit; ADMIN metrics và CLI monitor alerts JSON/nonzero exit, worker-stale negative/recovery check. Chưa external monitoring collector/alert delivery.
- Rà soát GSC totals: phép tính Phase 3 đúng cho các dòng đã thu thập, không phải property total. Giữ math/hash/schema facts; thêm nhãn UI về phạm vi dataset/hidden queries/row caps, không nội suy số liệu.

## Tests thực tế

Lệnh chính `npm run verify:phase4` chạy regression Phase 1–3, security pattern scan, production dependency audit, hai Docker builds, TLS staging, encrypted backup/restore và operations/retention. Bản mới của runner có thêm worker-stale recovery; test này cũng đã chạy riêng sau full gate. Logs private `.orbit/phase4-*.log`; kết quả chia sẻ dưới `docs/evidence/`. Không dùng zero-test/skipped để thay PASS.

| Nhóm                                                       | Kết quả                                                                                                                                                | Evidence                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Unit                                                       | 29/29 PASS, 0 skip/fail                                                                                                                                | unit.log                                                           |
| PostgreSQL integration                                     | 38/38 PASS, 0 skip/fail                                                                                                                                | integration.log                                                    |
| Typecheck / production build                               | PASS                                                                                                                                                   | typecheck.log, build.log                                           |
| Foundation + Phase 2 + Phase 3 backend–worker–database E2E | PASS                                                                                                                                                   | phase1-e2e.json, phase2-offline-e2e.json, phase3-e2e.json, e2e.log |
| Browser                                                    | PASS 11 nhóm, 9 views mobile 390 px, 0 runtime exceptions                                                                                              | browser-checks.json và screenshots                                 |
| HTTPS staging E2E                                          | PASS: login/logout/CSRF/RBAC, real worker + PG, MOCK multi-AI SEO 7 bước/10 artifacts, checksum approval/reports, restart, worker credential isolation | phase4-staging.json                                                |
| Migration fresh + Phase 3 upgrade/repeatability            | PASS, không reset owner/workspace                                                                                                                      | integration migration test và logs                                 |
| Rotation / retention / quota                               | PASS: transactional rotation rollback, wrong owner/key/tamper, referenced/recent blob protection, explicit deletion, active-run quota + replay         | integration/unit logs                                              |
| Encrypted backup/restore thật                              | PASS, 13 runs + 81 blob hashes, 0 sessions sau restore; target trùng/corrupt archive bị từ chối                                                        | phase4-backup-restore.json                                         |
| Monitoring / retention CLI                                 | PASS healthy metrics, real stopped-worker alert/nonzero và restart recovery; retention DRY_RUN                                                         | phase4-operations.json và phase4-verification.json                 |
| Security gates                                             | PASS; npm audit production 0 vulnerabilities; known local secrets không ở staged files/client assets                                                   | phase4-security.json, security-scan.json                           |
| Public Caddy config                                        | Offline validation PASS; không xin cert hoặc mở ingress                                                                                                | phase4-security.json                                               |
| Remote GitHub Actions / public ACME / LIVE APIs            | Chưa chạy/BLOCKED                                                                                                                                      | Không có bằng chứng remote/public/live                             |

Local images đã kiểm thử: app `sha256:f91442dd5a5b54d007e461f2f20fad186c403fbef669f88619935c092994dc0a`; ops `sha256:68e5ec5f6580d449a27a540aacbdb662c95879830706122d301630b866ff7241`. Base Node/Postgres/Caddy được pin digest. Host Node 24.19.0; pinned container Node 24.22.2. Không claim image đã publish registry.

Các lỗi phát hiện và đã sửa: scope quyền DB cho mock health update, browser click khi form còn disabled, fixture thiếu cột bắt buộc ở migration/rotation tests, TLS service trên Docker internal-only network không publish được loopback port, ownership file ops cho non-root và retention query tên cột blob_key. Lượt cuối full gates PASS. Không dùng các lượt lỗi làm bằng chứng thành công.

## Milestone B còn thiếu và điều kiện public/production

Public cần lựa chọn hosting/project/region, ngân sách, domain/DNS, admin email và phê duyệt deploy/mở Internet. Không thiếu API key nào cản local staging. Chi phí và cấu hình chính xác trong DEPLOYMENT.md; dự toán VM/backup/domain chỉ tham khảo, cần xác nhận theo region/provider trước tạo paid resources.

Chưa có backup offsite/fresh-host drill/RPO-RTO thật, external alert sink, independent security audit và OS image CVE scan; chưa host firewall/IAM/TLS ACME/cloud deployment acceptance. Không có SSO/MFA/self-service password recovery, object storage cloud hoặc cross-owner workspace sharing. CI file đã chuẩn bị, remote run chưa xác minh. Backup scheduler đã chạy immediate startup/manual, chưa quan sát một chu kỳ 24 giờ thực. Không tuyên bố production ready.

GSC LIVE cần OAuth web client/consent/property và official dataset receipt; AI LIVE cần ít nhất hai provider credentials/model/pricing/quota và quyền paid calls riêng. Cả hai nghiệm thu tách biệt. Website write/publish không triển khai.

## Tài liệu và thao tác tiếp theo

[DEPLOYMENT.md](DEPLOYMENT.md): local startup, hosting/cost, public prerequisites, update/rollback. [SECURITY.md](SECURITY.md): threat boundaries và test scope. [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md): schedule/restore/key rotation/retention. [OPERATIONS.md](OPERATIONS.md): logs/health/alerts/recovery. README/ARCHITECTURE/DATABASE_SCHEMA/ROADMAP/TASKS được cập nhật.

Deploy sau phê duyệt: provision private config/admin → migrate/grants → start services → HTTPS MOCK acceptance. Update: backup + restore drill → dừng web/worker → image bất biến + migrate/grants → readiness/login/workflow. Rollback: image cũ nếu schema tương thích; nếu không, restore vào database/artifact volume mới, giữ nguồn và cutover có kiểm chứng. Không auto downgrade migration hoặc `down -v`.

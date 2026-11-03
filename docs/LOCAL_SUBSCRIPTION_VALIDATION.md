# Local-first / Subscription AI — validation

Baseline `531ef61338f1fd7c3c984c332f969e63aa870bb5`, branch gốc orbit/phase4-secure-staging và working tree sạch đã xác minh. Branch triển khai riêng `orbit/local-subscription-ai`. Đã đọc PRODUCT_DECISIONS/PHASE4_VALIDATION/source, chạy lại baseline 29 unit + 38 integration/build/typecheck/E2E/browser trước sửa; giữ ở `docs/evidence/local-baseline/`. Giữ 7 shared packages, engine và UI hiện có, không copy/sửa Claude Code.

## Trạng thái bàn giao

| Phạm vi                                  | Trạng thái                                           | Giới hạn                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Local Mode + Windows/WSL2 entry scripts  | CODE IMPLEMENTED                                     | Native loopback web/worker, Docker PG/backup, owner/auth, durable data/checkpoints, no auto-resume               |
| Local runtime acceptance                 | LINUX EQUIVALENT VERIFIED                            | Installer/start/stop/restart/resume/approval/artifact checksum và encrypted restore đã chạy thật                 |
| Windows 10 + Docker Desktop/WSL2         | BLOCKED — không có Windows host                      | Không suy ra từ Linux, shell syntax hoặc kiểm source PowerShell; checklist máy thật trong LOCAL_SETUP_WINDOWS.md |
| Codex CLI                                | CODE + CLI_STUB TESTED, official interface inspected | Version 0.166.0, help/config/login status qua CLI thật; NOT_SIGNED_IN, **LIVE BLOCKED**                          |
| Gemini CLI                               | CODE + CLI_STUB TESTED, official interface inspected | Version 0.66.0, help/config có thật; chưa login/probe; **LIVE BLOCKED**                                          |
| Claude Code subscription                 | BLOCKED eligibility                                  | Chưa xác minh quyền dùng qua third-party orchestrator; không adapter/circumvention                               |
| Grok subscription                        | UNSUPPORTED trong implementation này                 | Chưa có cơ chế subscription chính thức được xác minh; không dùng SDK API key thay thế                            |
| Public hosting/paid REST/billing changes | Không thực hiện                                      | Ngoài phạm vi theo quyết định cuối                                                                               |

Không tuyên bố mọi điều kiện Windows/LIVE hoàn tất. Đăng nhập thuê bao và phép thử inference cần hành động/consent của chính người dùng, không yêu cầu token hoặc password trong chat.

## Đã triển khai thực sự

- PowerShell Install/Orbit + WSL2 bridge, pinned official Node 24.22.2 bootstrap có SHA-256, private config/secrets/artifacts/checkpoints, Docker Desktop Compose PostgreSQL/backup. App cài riêng theo user, không sửa system Node hoặc Claude profiles. Script start/stop/restart/update/backup/restore/status và install/login CLI.
- Web chỉ 127.0.0.1:3210; PostgreSQL bind loopback 55434. Single-owner login/API check, database roles tách runtime/ops; local single-worker lease. Khi worker khởi động, QUEUED/RUNNING → PAUSED và có audit, không tự chạy lại. WAITING_APPROVAL tiếp tục chờ người dùng. Config ghi atomically, update không reset data, restore fresh DB/artifact directory, giữ nguồn và revoke sessions.
- Official Codex/Gemini CLI adapters độc lập REST trong package providers. Bounded input/output, strict schema, fixed executable/args, shell=false, child environment allowlist, official isolated profiles, timeouts và cancellation process group. Không đọc/copy credentials CLI bằng ORBIT, không thực thi AI output như command. App MCP/shell/multi-agent/web tools Codex bị disable; Gemini enforced OAuth + deny tools + overage never. Enforcement với inference thật chưa LIVE verified.
- Router/admission phân biệt LIVE_CLI / LIVE_API / CLI_STUB; chỉ latest official execution receipt verified có hiệu lực 15 phút mới admit. Hai provider khác vendor, structured data/checksum/validation/approval dùng lại engine. Provider PostgreSQL lease/concurrency, bounded attempts. Quota/auth pause và không API fallback; AI planning không nuốt quota để rơi về template. HTTP Cancel aborts subprocess.
- Local Mode chặn REST registry, probe endpoint và paid transport trước network dù environment có key. Không sửa subscription/billing settings. Không hứa quota vô hạn hoặc suy đoán remaining allowance; Gemini overage disabled theo setting chính thức, Codex billing/quota do provider/account thực thi, ORBIT không đọc/chỉnh billing.
- AI & Kết nối có methods/login instructions/status/real consent probe. NOT_INSTALLED / NOT_SIGNED_IN / CONNECTED / LIMIT_REACHED / UNSUPPORTED, thêm NOT_VERIFIED và BLOCKED. Remaining quota null khi chưa có dữ liệu chính thức. CLI installed ≠ connected.

## Kiểm thử đã thực thi

`npm run verify:subscriptions` chạy pipeline và kiểm timestamps của E2E mới; không có zero-test/skip dùng làm PASS. Logs chi tiết private `.orbit/subscription-*.log`, kết quả chia sẻ trong `docs/evidence/`.

| Check                                        | Kết quả                                                                                                    | Evidence                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit                                         | 33/33 PASS, 0 skip/fail                                                                                    | unit.log                                                                                                                     |
| PostgreSQL integration                       | 44/44 PASS, 0 skip/fail                                                                                    | integration.log                                                                                                              |
| Typecheck / Next production build            | PASS                                                                                                       | typecheck.log, build.log                                                                                                     |
| Phase 1–4 backend/worker/database regression | PASS                                                                                                       | phase1-e2e.json, phase2-offline-e2e.json, phase3-e2e.json, e2e.log                                                           |
| CLI multi-AI backend E2E                     | PASS — CLI_STUB subprocesses                                                                               | subscription-cli-e2e.json: provider handoff, approval, restart, quota pause, HTTP Cancel                                     |
| Local manager E2E                            | PASS — Linux equivalent                                                                                    | local-mode-e2e.json: real install/restart/pause/resume/approval + checksum download + encrypted dump/restore/preserve source |
| Browser                                      | PASS, 12 groups, 9 views at 390 px, 0 runtime exceptions                                                   | browser-checks.json; includes subscription card eligibility/status/buttons                                                   |
| Node installer                               | Official 24.22.2 downloaded, pinned SHA-256 matched and executable ran; Bash syntax PASS                   | subscription-interface.json                                                                                                  |
| Official CLI package/interface               | Installed Codex 0.166.0/Gemini 0.66.0, version/help inspected and Codex offline login status NOT_SIGNED_IN | subscription-live.json, subscription-interface.json                                                                          |
| Security / dependency audit                  | Focused checks PASS, npm audit production dependencies 0 vulnerabilities                                   | local-subscription-verification.json, security-scan.json                                                                     |
| Windows host + subscription inference        | BLOCKED, chưa thực thi                                                                                     | Không gộp CLI_STUB/Linux thành LIVE/Windows proof                                                                            |

Update fast-forward đã có code và bảo vệ dirty tree/backup trước update. Acceptance thực tế được ghi riêng ở local-update.json khi chạy trên branch đã push và tree sạch; không suy ra từ start/restart test.

Các lỗi phát hiện/sửa: JSONB array encoding, import khởi tạo DB quá sớm trong tests, readiness race khi tạo goal ngay sau worker restart, restore move từ tmpfs sang persistent filesystem (đổi copy + verify), restore lặp lại dùng destination mới và config atomic. Môi trường từng ENOSPC khiến PostgreSQL không tạo test DB; dọn build cache tái tạo được, giữ nguyên DB/artifacts/backups, chạy lại toàn bộ gates và PASS. Không lấy lượt lỗi làm bằng chứng thành công.

## Tài liệu và bước nghiệm thu còn lại

- [LOCAL_SETUP_WINDOWS.md](LOCAL_SETUP_WINDOWS.md): prerequisites Windows/Docker Desktop/WSL2, install/start/stop/restart/update/backup/restore/login và checklist Windows thật.
- [SUBSCRIPTION_AI_INTEGRATION.md](SUBSCRIPTION_AI_INTEGRATION.md): sources chính thức, eligibility, flags/config, schema/security/quota và phân biệt các mức verification.
- PRODUCT_DECISIONS/README/ROADMAP/TASKS cập nhật Windows localhost/subscription-only; public/API gates cũ giữ như lịch sử, không phải điều kiện mới.

Trên máy người dùng: nghiệm thu Windows localhost trước → cài CLI và đăng nhập ChatGPT/Google chính thức → đồng ý request nhỏ qua nút kiểm tra → ghi LIVE_CLI receipt của ít nhất một provider, rồi kiểm cả hai cho multi-AI workflow và human approval. Không dùng API key trả phí, không thay billing và không nhận cookie/token trong chat. Claude chỉ xem xét sau khi eligibility được chứng minh; Grok giữ UNSUPPORTED.

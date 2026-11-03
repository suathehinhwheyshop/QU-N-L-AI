# Provider correction — validation

Baseline `orbit/local-subscription-ai`, HEAD `f5eee5081acc92572132abfca68b60f773c42d79`, working tree sạch đã xác minh. Branch riêng `orbit/subscription-provider-correction`, không merge main. Baseline đã chạy lại 33 unit + 44 integration/typecheck/build/E2E/browser; giữ dưới `docs/evidence/provider-correction-baseline/`. Giữ engine và 7 packages, không viết lại Master Prompt/kiến trúc và không can thiệp codebase Claude.

## Provider status

| Provider            | Implementation                                                                                         | Verification                                                                      | Runtime gate                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ChatGPT / Codex CLI | **IMPLEMENTED** official login + non-interactive structured adapter, timeout/cancel, quota/checkpoints | Official version/help/config/login-status inspected; CLI_STUB tests PASS          | **BLOCKED LIVE**: included-only enforcement chưa verified; chặn trước real prompt, không env tự chứng nhận |
| Claude Max 5x       | Metadata/eligibility policy, chưa runtime adapter                                                      | SDK Commercial Terms README đã đọc, chưa xác minh đủ quyền dùng Max qua ORBIT/SDK | **BLOCKED** eligibility/auth/quota scope                                                                   |
| Grokbot             | Metadata/entitlement policy, chưa runtime adapter                                                      | Official Grok Build auth/headless docs có thật; Grokbot entitlement chưa mapped   | **BLOCKED**; không thay bằng Grok chat, community CLI hoặc paid xAI API                                    |
| Gemini              | Adapter cũ retained optional                                                                           | Regression CLI_STUB cũ được giữ, không dùng Google account                        | **DISABLED** mặc định trong UI/install/login/probe/registry, không tự bật reviewer                         |

VERIFIED interface/source/CLI_STUB không phải account entitlement hoặc LIVE inference. Không có real model call trong lượt này; không overage/top-up/billing changes hoặc API key trả phí. Multi-AI LIVE hiện không có đủ hai eligible vendors và phải tiếp tục bị chặn.

## Local isolation đã triển khai

- Codex default **127.0.0.1:3211**, PostgreSQL **55435**, database ban đầu `orbit_codex`, `.orbit/codex`, project prefix `orbit-codex-`, image `orbit-ops:codex-local`; volume/secrets/artifacts/checkpoints/CLI profile riêng. Không tự chọn/migrate/reset `.orbit/personal` hoặc profile 3210.
- Config phải có instance=codex và đúng namespace/ports. Legacy profile bị từ chối trước khi thay đổi files/data. Port 3211 bận thì fail, không kill tiến trình khác hoặc fallback 3210.
- Cookie riêng `orbit_codex_session` và `orbit_codex_gsc_oauth`, logout/challenge không ghi đè tên cookie cũ. Đây là chống xung đột giữa các ứng dụng local tin cậy, không phải sandbox bảo mật đối với một app độc hại cùng host.
- Next build riêng `.next-codex`. **Installer/updater cần checkout Codex riêng** để không chia sẻ node_modules/source với bản Claude. Hướng dẫn dùng `/home/TEN/ORBIT-Codex`, không trỏ Repository vào nguồn Claude. Không tự clone/move/xóa codebase khác.
- Start/stop/restart/backup/restore và no-auto-resume được giữ. Existing Stage/Phase 1–4 không đặt marker codex vẫn giữ `.next`/cookie names trước đây.

## Kiểm thử thực tế

Lệnh `npm run verify:subscriptions`: real local install + frozen dependencies/build, regression unit/integration/typecheck/production build/legacy E2E/browser, CLI_STUB backend E2E, local manager E2E, subscription UI browser 390 px, official **Codex-only** install/offline status, security/audit và shell syntax. Logs private `.orbit/provider-correction-*.log`/`.orbit/subscription-*.log`; evidence chia sẻ trong docs/evidence.

| Nhóm                                   | Kết quả                                                                                                                                       | Evidence                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Unit                                   | 37 PASS, 0 fail/skip                                                                                                                          | unit.log                                                  |
| PostgreSQL integration                 | 47 PASS, 0 fail/skip; giữ regression Phase 1–4                                                                                                | integration.log                                           |
| Typecheck/build                        | PASS                                                                                                                                          | typecheck.log/build.log                                   |
| Backend/worker/database E2E cũ         | PASS MOCK/HTTP_STUB, không LIVE                                                                                                               | phase1-e2e.json, phase2-offline-e2e.json, phase3-e2e.json |
| CLI subprocess E2E                     | PASS CLI_STUB; handoff, approval, restart, quota pause/cancel                                                                                 | subscription-cli-e2e.json                                 |
| Local Codex E2E                        | PASS Linux equivalent trên **3211**, real PostgreSQL/worker, backup/restore/checksum/manual Resume                                            | local-mode-e2e.json                                       |
| Coexistence                            | Sentinel HTTP **3210** còn hoạt động qua Codex restart/restore/stop, config/cookies/data namespaces riêng; legacy config fixture không bị đổi | local-mode-e2e.json, provider-policy unit/integration     |
| Default providers/UI                   | Đúng Claude Max5x/ChatGPT/Grokbot; không Gemini, fresh/old receipt không vượt gates                                                           | browser-checks.json, provider-policy tests                |
| Codex-only included quota gate         | Unverified policy/forged env không gọi runner, disabled Gemini không tạo probe receipt                                                        | provider-policy tests                                     |
| Security/audit                         | Focused scan và known-secret scan; npm production audit 0 vulnerabilities                                                                     | security-scan.json và aggregate verification              |
| Windows 10/real Claude app coexistence | **BLOCKED_NO_WINDOWS_HOST**, sentinel/Linux không thay thế máy thật                                                                           | checklist LOCAL_SETUP_WINDOWS.md                          |
| Actual subscription inference          | **BLOCKED**, không login/allowance policy proof                                                                                               | subscription-live.json                                    |

Nguồn Grok Build/Anthropic/Codex và checksum snapshots được ghi trong provider-correction-research.json. Không cài hoặc chạy Claude/Grok CLI. Không coi synthetic provider_probes trong tests là LIVE receipt. Tests có thể dùng optional Gemini adapter như fixture cũ; không cài Gemini mặc định hoặc gửi prompt Google.

Update bổ sung đã chạy trên branch sạch đã push: backup-first, pull --ff-only (remote ở latest), migrations/grants/build `.next-codex` và image Codex riêng; giữ database/owner/artifact bytes, `.next/BUILD_ID` và metadata profile legacy 3210 không đổi; không auto-start/Resume. Evidence provider-correction-update.json. Đây là Linux verification, không phải app Claude/Windows thật.

## Research findings và giới hạn

SDK Anthropic nêu Commercial Terms; README/technical CLI không tự xác nhận Max consumer quota dùng qua ORBIT. Claude giữ BLOCKED, không khẳng định mọi direct CLI automation bị cấm. xAI có official **Grok Build** browser OAuth/headless; đây là phát hiện sửa kết luận cũ. Chưa có bằng chứng gói Grokbot tương thích với Grok Build; community `superagent-ai/grok-cli` tự ghi không affiliated và cần API key, không được dùng.

Codex official configuration/help đã kiểm chưa cung cấp cơ sở verified cho only-included request enforcement. Không giả flag hoặc chỉnh account billing để vượt thiếu sót. Adapter code giữ nhưng real invoke/probe bị chặn bằng CLI_INCLUDED_ALLOWANCE_UNVERIFIED; 0 cents local không được coi là bằng chứng không dùng credits. Mở LIVE cần official enforcement phù hợp và thực nghiệm có consent. Không yêu cầu API key, token/cookie hoặc nhắc lại bối cảnh.

Windows scripts/WSL2/Docker Desktop acceptance và actual account entitlements chưa thực hiện do môi trường Linux, không báo Windows VERIFIED. Source/port/data isolation là implementation + Linux test; máy thật cần kiểm với bản Claude hiện có theo hướng dẫn. CI workflow có code, chưa nghiệm thu remote run. Không cần VPS/domain/Google Cloud.

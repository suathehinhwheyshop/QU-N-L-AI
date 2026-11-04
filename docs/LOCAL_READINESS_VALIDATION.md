# Local readiness follow-up — 04/11/2026

Baseline: branch `orbit/subscription-provider-correction`, HEAD `0db4535b37b106e522ccdb49789932fd62e83a94`, working tree sạch và remote trùng SHA. Baseline 37 unit đã chạy lại PASS; sandbox mặc định không cho HTTP/subprocess tests mở loopback, chạy cùng suite với quyền thực thi môi trường đã PASS, không sửa/skip assertions. Branch làm việc riêng: `orbit/local-readiness-followup`, không merge main.

## Implementation mới

- `ops/local-doctor.mjs` + action Windows `doctor`: trước/sau install, kiểm Node/Linux/WSL2, Docker Linux/Compose v2, config namespace Codex, secret metadata/permissions và loopback ports. Missing prerequisites/legacy profile/port conflict cho BLOCKED và exit 1. Không đọc secret contents, không cài/migrate/stop/restore, không dùng port 3210. File/dữ liệu cũ được giữ.
- `packages/providers/src/codex-account.ts` + action `check-codex`: official Codex app-server stdio, pin/version check, fixed read-only RPC sequence. Không tạo thread/turn, model call, consume reset credits, send credit email, token export hoặc config/billing write. Bounded 10 giây, 256 KiB output, argv array, isolated profile/scratch/env, cancellation/process-group cleanup. Không forward raw stderr, identity/email/account ID/credit balance.
- Quota windows/usedPercent/reset và `ordinaryUsageAllowed` chỉ lấy từ response schema chính thức. Missing/null vẫn unknown; không tự tính remaining quota, không suy ra chỉ dùng included allowance. Tất cả execution gates, provider descriptors và receipt logic giữ nguyên; account read không tạo DB record/CONNECTED/LIVE.
- 7 packages, engine/planner/router/approval/DAG và DB migrations không đổi. Chỉ Claude Max5x/ChatGPT/Grokbot mặc định; Gemini disabled, không bổ sung adapter/provider mới.

## Bằng chứng thực thi

`npm run verify:subscriptions` chạy local install, regression, CLI_STUB workflow, native local E2E, browser và official CLI/status/account-read, security/audit/syntax/format. Evidence mới trong `docs/evidence/local-readiness-verification.json` và aggregate `local-subscription-verification.json`.

| Check                                    | Kết quả                   | Phạm vi                                                                                                                                   |
| ---------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                     | 44 PASS, 0 fail/skip      | 37 regression + 7 read-only account/doctor tests                                                                                          |
| PostgreSQL integration                   | 47 PASS, 0 fail/skip      | Giữ regression Phase 1–4                                                                                                                  |
| Typecheck/production build               | PASS                      | Development build và isolated Codex production build                                                                                      |
| Backend–worker–database E2E              | PASS                      | MOCK/HTTP_STUB/CLI_STUB, không LIVE                                                                                                       |
| Native Codex E2E                         | PASS Linux equivalent     | Real 3211 conflict không kill listener; doctor nhận own web/DB; manual Resume, approval/artifacts, encrypted backup/restore, sentinel3210 |
| Browser desktop/390 px                   | PASS                      | Không suy ra Windows host từ browser Linux                                                                                                |
| Official Codex account read              | PASS signed-out interface | `NOT_SIGNED_IN`, usage null, execution BLOCKED; 0 prompts/inference                                                                       |
| Signed-in quota                          | CLI_STUB TESTED           | Chưa đọc quota từ tài khoản thật                                                                                                          |
| Windows 10/WSL2/Docker Desktop           | BLOCKED_NO_WINDOWS_HOST   | Script entry point chưa nghiệm thu trên Windows thật                                                                                      |
| AI inference / only-included enforcement | BLOCKED                   | Không có login/entitlement và verified request enforcement                                                                                |

CLI_STUB cases: read-only handshake, chunked JSONL, quota exhausted, signed-out/API-key rejection, stripped identities/credit payloads, malformed/oversized/error output, unexpected server token-refresh request, process early-exit và cancellation. Native E2E dùng PostgreSQL/worker/backup thật nhưng AI là MOCK. Remaining quota không được fabricated và official account-read không phải LIVE inference.

Nguồn đối chiếu: official `@openai/codex@0.166.0` binary `app-server generate-ts` và public protocol dưới tag `rust-v0.166.0` (GetAccountParams, GetAccountRateLimitsResponse, RateLimitSnapshot, RateLimitWindow). URLs/checksums ở evidence. `ordinaryUsageAllowed` là permission snapshot, không bảo đảm billing một request tương lai; included-only gate tiếp tục UNVERIFIED. Claude Max personal-orchestrator eligibility và Grokbot→Grok Build entitlement không thay đổi trạng thái BLOCKED trong lượt này.

## Bước nghiệm thu còn thiếu

Chạy checklist [Windows setup](LOCAL_SETUP_WINDOWS.md) trên máy Windows thật với checkout Codex riêng. Chủ tài khoản tự login official CLI tại terminal máy đó; không gửi token/password vào chat. `check-codex` đọc account/quota sau login vẫn không mở LIVE. Trước inference cần cơ chế only-included chính thức đủ cơ sở/thi hành được, consent execution và ít nhất hai vendors đủ quyền cho multi-AI. Không mua API key, bật overage/top-up hoặc thay billing để gỡ các blocker này.

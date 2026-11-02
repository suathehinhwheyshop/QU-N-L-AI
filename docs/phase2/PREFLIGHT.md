# Phase 2 preflight — 02/11/2026 UTC

Đã kiểm tra checkout `/workspace/QU-N-L-AI`, origin đúng repository `suathehinhwheyshop/QU-N-L-AI`. Parent branch `orbit/phase1-foundation-audit` và HEAD `9f07558652b1cf4be46c64d2ccaf23a55c311280` khớp yêu cầu. Tạo branch `orbit/phase2-real-multi-ai`, không merge main.

## Code thực tế ở parent

| Phần              | Kết quả audit                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend/API      | Next App Router tiếng Việt, fetch backend, local signed-cookie auth/Origin check                                                                 |
| 7 shared packages | shared/core/database/storage/providers/integrations/workspaces; compatibility reexports trong src                                                |
| Core              | Contract interpreter, template planner, validated read-only DAG, router, worker với PostgreSQL queue/leases/fencing/retry/timeout/control/budget |
| State/output      | PostgreSQL 13 bảng, artifacts checksum/content addressing, hash-bound human approval, audit/events                                               |
| Providers         | Bốn mock vendor adapters; chưa có REST API gọi thật                                                                                              |
| Workspaces        | SEO/Video/Research/Development; template/fixtures riêng; không thực thi công cụ chuyên ngành                                                     |
| GSC               | Fixture MOCK; chưa OAuth/API thật                                                                                                                |
| Legacy            | HTML archive, không tham gia acceptance                                                                                                          |

Baseline chạy lại trước sửa: `npm run verify:foundation` PASS, 14 unit, 10 PostgreSQL integration, typecheck, production build và E2E có restart app/worker. Logs/evidence được sao lưu riêng tại `docs/evidence/phase1-baseline/`.

## Môi trường

Node 24, Next 16, PostgreSQL 17 container local và worker riêng. Đọc AGENTS.md, installed Next.js route/data-security/client-server docs, cloud runtime/onboarding instructions. Giữ TLS/proxy/CA và HTTPS Git proxy. Không tạo worktree hoặc lấy code Claude Code.

Đã kiểm tra tên/trạng thái runtime variables và file cấu hình ignored, không in giá trị: bốn ORBIT_*_API_KEY đều vắng mặt, không có credential standard alias dùng được. Không coi chat subscription hoặc GitHub authentication là quyền AI API.

Draft đã lưu bốn HTTPS API hosts và yêu cầu server credential, giữ preset network hiện hữu; cập nhật start instructions. Save draft chưa apply/publish runtime. Chưa có secret binding. MOCK development/tests sẵn sàng; API thật vẫn BLOCKED. Người dùng cấu hình ít nhất hai API có quyền/quota trong environment settings; có thể bỏ provider không dùng khỏi draft khi review. Không gửi key qua chat.

## Phạm vi sửa

Giữ engine đã hoạt động, mở rộng đúng adapter contract/admission/accounting và durable planning handler. Không thay queue framework, không gán cứng Grokbot → Claude, không thêm GSC/CMS hoặc website writes. Xem IMPLEMENTATION_PLAN.md, PROVIDERS.md và docs/PHASE2_VALIDATION.md.

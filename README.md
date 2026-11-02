# ORBIT — Universal Multi-AI Orchestration Platform

Web điều phối đa AI: Next.js/TypeScript/React, PostgreSQL/Drizzle và worker độc lập. Giữ nguyên 7 shared packages, bốn workspace SEO/Video/Research/Development. Core không gán hãng AI vào vai trò nghiệp vụ, không phụ thuộc hoặc sao chép Claude Code.

Phase 1 đã chạy lại baseline từ `orbit/phase1-foundation-audit`, commit `9f07558`: 14 unit, 10 integration, typecheck/build và E2E qua backend/worker/database đều PASS. Bằng chứng được giữ tại [docs/evidence/phase1-baseline](docs/evidence/phase1-baseline).

Phase 2 bổ sung bốn adapter REST độc lập, cấu hình model/giá, probe, structured handoff, accounting và AI planning có validation/fallback. **Chưa nghiệm thu LIVE:** môi trường hiện thiếu cả bốn API credentials. HTTP_STUB/MOCK tests không chứng minh đã gọi AI thật. Xem [báo cáo kiểm thử Phase 2](docs/PHASE2_VALIDATION.md) và [live evidence](docs/evidence/phase2-live.json).

## Chạy development

Cần Node.js 24 và Docker local, hoặc PostgreSQL đã cấu hình.

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run db:seed
npm run dev -- --port 3200
```

Chạy `npm run worker` trong terminal khác. Web/worker phải dùng cùng database và storage. `setup:local` giữ cấu hình có sẵn; lần đầu tạo credential ngẫu nhiên trong `.env.local` và `.orbit/postgres.env` (ignored, chmod 0600). PostgreSQL bind loopback `127.0.0.1:55432`, volume riêng. Đăng nhập bằng `ORBIT_ADMIN_PASSWORD` phía server; không gửi mật khẩu vào chat/log. `ORBIT_BASE_URL` phải khớp origin truy cập để kiểm tra CSRF. Chưa có URL production/public.

## Bật API thật khi đã có quyền API

1. Đặt ít nhất hai trong `ORBIT_OPENAI_API_KEY`, `ORBIT_ANTHROPIC_API_KEY`, `ORBIT_GOOGLE_API_KEY`, `ORBIT_XAI_API_KEY` trong secret/environment phía server. Khởi động lại web và worker. Không dùng biến `NEXT_PUBLIC_*`; không nhập key vào frontend. Gói thuê bao chat không bao gồm API credit/quyền API mặc định.
2. Cho phép egress HTTPS đến endpoint tương ứng: `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.x.ai`. Transport tôn trọng proxy/CA của môi trường; không tắt TLS verification.
3. Trong **Cài đặt**, chọn External data policy, đặt ngân sách. Bản local vẫn bắt buộc read-only.
4. Trong **Kết nối**, nhập model ID mà tài khoản thực sự có quyền, giá input/output USD/1M tokens, nguồn/ngày giá và giới hạn tokens. Không có giá hoặc model entitlement mặc định. Lưu cấu hình và đồng ý chạy probe có tính phí.
5. Probe thực hiện structured generation trên API chính thức. Chỉ probe hợp lệ, khớp cấu hình/credential và chưa quá 15 phút mới được router coi là sẵn sàng. Thiếu key, thay model/giá/key, lỗi auth/model/response hoặc probe hết hạn sẽ chặn lựa chọn LIVE. HTTP stub không kích hoạt LIVE.
6. Tạo goal ở Research/Video/Development, chọn LIVE, đồng ý gửi input đến AI. Chọn Template hoặc AI planning có fallback, đặt ngân sách đủ reservation. Preview không gọi AI tính phí; AI planning chạy trong worker như task có checkpoint.
7. Theo dõi outputs/attempt usage/logs. Review dùng provider khác analyst. Duyệt bảng việc theo checksum trong UI trước khi xuất báo cáo.

LIVE Phase 2 phân tích **yêu cầu người dùng**, không tự đọc website, GSC, video hay chạy code. SEO vẫn MOCK đến khi có GSC thật ở Phase 3. Upload lưu bytes thật nhưng chưa trích nội dung vào prompt; không dùng upload thay thế nguồn đã đọc.

Probe có ledger riêng: tổng chi phí/reservation probe trong 24 giờ không vượt giới hạn ngân sách trong Settings; mỗi provider cách tối thiểu 10 giây, một probe chạy mỗi owner. Ngân sách workflow độc lập. Token usage do API báo; chi phí được ước tính từ giá operator cung cấp và làm tròn lên cents, không phải hóa đơn hãng. Lỗi/timeout/crash có khả năng đã tính tiền sẽ được ghi chi phí bảo thủ bằng reservation; retry inference có thể tạo phí mới. Không hứa exactly-once cho inference API.

## Kiểm thử và bằng chứng

```sh
npm run verify:phase2
npm run verify:live
```

`verify:phase2`: unit/protocol tests, integration PostgreSQL, typecheck, production build, E2E với web/worker thực. Giữ mọi regression Foundation, thêm schema planning → hai mock providers → approval → 7 artifacts. Không gọi API bên ngoài. Evidence: `docs/evidence/phase2-offline-verification.json` và command logs.

`verify:live`: mặc định không thực hiện paid calls. Thiếu credential hoặc cấu hình sẽ ghi BLOCKED và exit 2, không giả PASS. Sau khi kiểm tra cấu hình, `npm run verify:live -- --execute` xác nhận cho phép script probe hai provider, tạo run Research LIVE và chạy worker. Script dừng ở WAITING_APPROVAL, lưu receipts/usage và run ID; người dùng duyệt trong UI để hoàn tất delivery. PASS_TO_APPROVAL chưa phải nghiệm thu trọn Phase 2.

Có thể chạy riêng `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run build`, `npm run test:e2e`. Integration/E2E tạo database `orbit_test_<random>` riêng, migration và dọn sau kiểm thử; DB user cần quyền tạo database. E2E dùng cổng 3201, bỏ toàn bộ AI keys khỏi child environment, restart cả app và worker, kiểm tra controls/retry/ownership/checksum. `npm run verify:foundation` vẫn chạy regression tương thích.

Browser: chạy app/worker cổng 3200, Chromium test profile với CDP 9230 rồi `npm run test:browser`. Restart dev server sau production build để tránh chunks cũ. Script tạo run MOCK trong DB development, kiểm tra desktop/mobile 390 px và chụp evidence; không dùng browser profile cá nhân. Format: `npm run format:check`.

## Tài liệu và phạm vi

- [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md).
- [Audit và quyết định Phase 2](docs/phase2/PREFLIGHT.md), [thiết kế adapter](docs/phase2/PROVIDERS.md).
- Packages: shared, core, database, storage, providers, integrations, workspaces; composition tại `src/server/runtime.ts`, worker tại `src/worker.ts`. Các re-export trong `src/core`… giữ compatibility.
- `legacy/seo-demo` là tài liệu prototype, không phải app nghiệm thu.

Chưa có GSC/CMS/Drive/Gmail/Grokbot/browser connectors thật, OIDC production, object storage cloud, backup/restore hoặc deployment Google Cloud đã xác minh. Không sửa website, xuất bản, gửi email, thanh toán, xóa dữ liệu. Auth local single-user chỉ cho development; production hardening thuộc Phase 4.

# ORBIT — Universal Multi-AI Orchestration Platform

Phase 1 Foundation: Next.js 16 + TypeScript/React + Tailwind, PostgreSQL 17/Drizzle, durable worker, DAG, routing, schema validation, bounded retry/recovery, approval, artifacts và audit. UI tiếng Việt, desktop/mobile. Đây là backend và engine thực thi có lưu trữ thật; các AI và GSC hiện là **MOCK**, không phải kết nối API thật.

MVP SEO: nhận goal → đọc GSC fixture → phân tích → provider thứ hai phản biện → bảng việc → người dùng phê duyệt → kiểm chứng và xuất báo cáo. Không sửa website.

## Development

Node.js 24, Docker daemon local (hoặc một PostgreSQL riêng đã cấu hình).

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run db:seed
npm run dev -- --port 3200
```

Ở terminal thứ hai:

```sh
npm run worker
```

`setup:local` giữ nguyên cấu hình có sẵn; lần đầu tạo mật khẩu ngẫu nhiên trong `.env.local` và `.orbit/postgres.env` (đều ignored, chmod 0600). PostgreSQL chỉ bind `127.0.0.1:55432`, có volume riêng. Mật khẩu đăng nhập development là `ORBIT_ADMIN_PASSWORD` trong cấu hình local; xem riêng trên máy, không gửi vào chat/log/repository. Web và worker phải dùng cùng DATABASE_URL/storage. ORBIT_BASE_URL phải khớp origin đang truy cập để CSRF check hoạt động. Nếu đổi port, sửa cấu hình server tương ứng và restart.

Cấu hình môi trường ngoài: dùng `.env.example`, tạo secret đủ mạnh qua cơ chế server. Không dùng credential development để deploy public. Web mặc định chỉ listen loopback; chưa có URL public.

## Kiểm thử

```sh
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run typecheck
```

Integration/E2E tạo database `orbit_test_<random>` riêng, chạy migration và xóa database đó sau test; tài khoản database development cần quyền tạo DB. Không xóa run trong database development. E2E tự mở Next production server cổng 3201 và worker riêng, dừng/restart cả web server và worker, kiểm tra approval, artifact checksum, ownership và chính sách read-only. Cần build trước E2E. Trong cloud sandbox, socket/child process có thể cần quyền thực thi bổ sung.

Browser test bổ sung: chạy app/worker cổng 3200; mở Chromium với profile test riêng và `--remote-debugging-port=9230`; chạy `npm run test:browser`. Sau npm ci hoặc production build, khởi động lại dev server trước khi chạy browser test để không dùng JS chunks cũ. Script đăng nhập bằng credential local, upload fixture, tạo một run MOCK trong database development và chụp ảnh vào docs/evidence. Không sử dụng profile trình duyệt cá nhân. Trong container dùng `--headless --no-sandbox --disable-dev-shm-usage`; đây không phải cấu hình browser automation production.

Format: `npm run format:check`. Các kết quả hiện tại ghi trong docs/PHASE1_VALIDATION.md. Ảnh chụp thật và E2E evidence nằm ở docs/evidence.

## Kiến trúc và lộ trình

- [ARCHITECTURE.md](ARCHITECTURE.md): lựa chọn stack, ranh giới core/provider/tool/workspace, policy và giới hạn.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md): schema; nguồn chuẩn packages/database/src/schema.ts và migrations/.
- [ROADMAP.md](ROADMAP.md): bốn phase theo master prompt.
- [TASKS.md](TASKS.md): checklist và blocker.
- packages/core (@orbit/core): Goal Interpreter, generic engine và interfaces; không import nghiệp vụ cụ thể.
- src/server/runtime.ts: composition root lắp provider/handler/template.
- packages/workspaces: bốn module SEO, Video, Research, Development với templates/fixtures riêng.
- packages/providers: bốn vendor mock adapters độc lập (Anthropic/OpenAI/Google/xAI), chưa có API LIVE.
- packages/integrations: một GSC fixture connector có schema/scope/health; GSC thật chưa kết nối.
- legacy/seo-demo: giữ prototype trước; không phải ứng dụng mặc định hiện tại.

## Giới hạn rõ ràng

Planner hiện dùng template có kiểm tra DAG, chưa AI planning tự do. Bốn vendor mock adapters không gọi mạng. LIVE bị chặn; chưa có API keys/quyền GSC được xác minh, chưa có CMS write/Gmail/Grokbot/browser connector. Upload lưu bytes thật nhưng mock không đọc nội dung upload để phân tích. Artifacts dùng filesystem bền vững tại development và metadata PostgreSQL; cloud object storage chưa triển khai. Auth local single-user là nền development, chưa production OIDC. Backup/restore, deployment, monitoring và security review đầy đủ thuộc Phase 4. Không báo có tối ưu website hoặc tăng trưởng SEO từ kết quả MOCK.

## Nghiệm thu Foundation sau audit

```sh
npm run verify:foundation
```

Runner chạy unit/integration, typecheck, production build và E2E; dừng nếu bất kỳ bước lỗi hoặc không có test nào chạy. Log và summary nằm trong docs/evidence, dữ liệu E2E luôn gắn MOCK. Browser test chạy riêng sau khi restart dev server. Ma trận 10 điều kiện: [docs/PHASE1_ACCEPTANCE.md](docs/PHASE1_ACCEPTANCE.md); audit ban đầu: [docs/CODEBASE_AUDIT.md](docs/CODEBASE_AUDIT.md).

Kết quả lượt nghiệm thu mới: 14 unit, 10 PostgreSQL integration, E2E với restart app/worker và kiểm tra controls/retry; không dùng kết quả HTML demo để thay bằng chứng.

Model configuration: mở Kết nối, chọn model MOCK hợp lệ và bật/tắt adapter, lưu vào backend. Cấu hình theo owner có hiệu lực với task được claim tiếp theo, không đổi model của attempt đã chạy. LIVE model/API chưa triển khai, không có nút giả để đánh dấu Connected. GET bootstrap trả cấu hình owner; GET connections là catalog metadata.

Npm workspaces: packages/shared, core, database, storage, providers, integrations, workspaces. Frontend/backend đặt tại src/app, src/components, src/server và src/worker.ts; các re-export trong src/core… chỉ phục vụ tương thích import. Không cần chuyển toàn bộ repo sang nhiều deployment để có ranh giới package.

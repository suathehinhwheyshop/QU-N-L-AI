# Phase 3 — validation và bàn giao

Baseline xác minh: `orbit/phase2-real-multi-ai`, full HEAD `b6bb1fc2b1f0e7a7f5b9258a45bc0d2362d1bc98`, working tree ban đầu sạch. Branch triển khai `orbit/phase3-gsc-seo-workflow`, không merge main. Kết quả Phase 2 đã chạy lại trước sửa và lưu riêng ở `docs/evidence/phase2-baseline/`: 19 unit, 19 integration, typecheck/build và backend–worker–database E2E PASS.

## Trạng thái nghiệm thu tách biệt

| Phạm vi               | Kết quả  | Ý nghĩa                                                                              |
| --------------------- | -------- | ------------------------------------------------------------------------------------ |
| CODE COMPLETE         | Có       | Các thành phần Phase 3 bắt buộc đã triển khai; giữ 7 packages và engine Phase 1–2    |
| HTTP_STUB TESTED      | PASS     | OAuth/GSC và hai giao thức AI được kiểm tra bằng HTTP local, có database/worker thật |
| GSC LIVE VERIFIED     | BLOCKED  | Chưa có OAuth client ID/secret và Google consent/property grant thật                 |
| AI LIVE VERIFIED      | BLOCKED  | Thiếu API credentials; giữ nguyên blocker Phase 2                                    |
| Website write/publish | Không có | Chỉ đọc, phân tích, lập bảng việc và xuất báo cáo sau human approval                 |

Không dùng CODE COMPLETE hoặc HTTP_STUB TESTED để tuyên bố Phase 3 đã hoàn tất nghiệm thu LIVE. Không có paid AI call nào được thực hiện trong lượt này.

## Tests thực tế

Chạy `npm run verify:phase3`; runner giữ exit status, từ chối zero-test, kiểm tra timestamps E2E/browser mới trong lượt chạy. Logs dưới `docs/evidence/`, summary `phase3-offline-verification.json`.

| Nhóm                       | Kết quả                                                                                                                     | Evidence                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unit/protocol              | 25/25 PASS, không skip                                                                                                      | unit.log                                         |
| PostgreSQL integration     | 31/31 PASS: 19 regression Phase 1–2 + 11 Phase 3 + 1 teardown reliability                                                   | integration.log                                  |
| TypeScript                 | PASS                                                                                                                        | typecheck.log                                    |
| Next production build      | PASS                                                                                                                        | build.log                                        |
| E2E Foundation và planning | PASS                                                                                                                        | phase1-e2e.json, phase2-offline-e2e.json         |
| E2E Phase 3                | PASS; OAuth/discovery/pagination qua API + app/worker restart từ page checkpoint, SEO 7 tasks, 10 artifacts gồm MD/CSV/JSON | phase3-e2e.json, e2e.log                         |
| Browser regression         | PASS 11 nhóm; 9 views ở 390 px, không runtime exceptions                                                                    | browser-checks.json, browser.log, seo-mobile.png |
| Live GSC verification      | BLOCKED; command exit 2 có chủ đích                                                                                         | phase3-gsc-live.json                             |
| Live AI verification       | BLOCKED; command exit 2 có chủ đích                                                                                         | phase2-live.json                                 |

Tests bao gồm: AES-GCM/AAD/IV/tamper; PKCE + state/browser nonce một lần, hết hạn/replay; token expiry và refresh serialized, 401 refresh một lần, 403 permission, 429 Retry-After/backoff, invalid_grant; revoke và REVOKE_PENDING; ngăn transport HTTP_STUB gửi token đến API chính thức; timeout, expired lease/fencing, pagination checkpoint, duplicate jobs/imports; immutable dataset/owner isolation; quantitative metrics, CSV parsing; từ chối invented figures/evidence/checksum; approval integrity, export bytes/checksums.

E2E dùng trusted server composition port trong test preload để cài GscClient HTTP_STUB ở cả Next và worker. Không có URL override qua HTTP hoặc cấu hình endpoint từ client. Stub giữ kind HTTP_STUB; không tạo CONNECTED/GSC_API giả. Hai adapter AI thực hiện HTTP trong integration; E2E và browser inference là MOCK. Mọi test dùng DB/profile riêng, không đưa fixture account hoặc xóa dữ liệu ở database development.

Các lỗi phát hiện khi triển khai đã xử lý: API mất mã lỗi OAuth khi adapter được cài từ server composition module khác; test Retry-After làm mất milliseconds khi chuyển PostgreSQL Date qua Date.parse. Teardown cũ force-terminate đua với pg-pool socket shutdown; đã thay bằng chờ disconnect thực sự và timeout fail khi còn leak, có negative integration test chứng minh không che rò rỉ kết nối. Lượt kiểm chứng cuối không còn test fail. Không dùng lần chạy lỗi làm bằng chứng PASS.

## Code thực sự được triển khai

- GSC OAuth 2.0 chỉ `webmasters.readonly`, PKCE S256, state hash + cookie nonce HttpOnly/Lax, TTL 10 phút và consume-once. Callback không yêu cầu cookie app Strict qua cross-site redirect; browser nonce và owner của state ràng buộc quyền đã bắt đầu từ request authenticated/Origin-checked.
- Access/refresh/verifier mã hóa AES-256-GCM, IV ngẫu nhiên và AAD theo owner/purpose; dedicated key 32 bytes, không dùng session secret. Refresh khóa row, retry 401 một lần; invalid_grant chặn và yêu cầu reauthorize. Revoke pending chặn đọc, retry revoke giữ ciphertext, success xóa token; không xóa một token mới vừa được reauthorize.
- Property discovery; Search Analytics page/query, search type/country/device/date filters, final data, pagination bounded và rate-limit handling. Endpoint đối chiếu Google discovery chính thức. Engine tool task dùng checkpoint từng page có attempt fence; không tạo engine/queue thứ hai.
- Dataset immutable: normalized current/previous, property và filters, capture time/Pacific timezone, source hashes, warnings. File CSV/JSON giữ raw-byte checksum; API pages giữ canonical normalized response envelope và request metadata, không giữ auth header/token. Import mang nhãn IMPORT/USER_SUPPLIED, không chứng minh API GSC.
- Deterministic totals, CTR từ sums, impression-weighted position, deltas, bounded top 20 evidence facts. Có chỉ báo dòng có/vắng ở mỗi kỳ; không kết luận giảm nếu dòng chỉ vắng. AI schema chỉ cho fact IDs + eligible reason/action/priority enums, không số liệu hoặc prose tùy ý. AI2 khác provider; validation đọc lại dataset/facts hash trước synthesis.
- Task Board chứa metrics/evidence/criteria, human approval bind checksum toàn board; renderer generic thêm MD/CSV/JSON vào cùng transaction hoàn thành delivery. CSV escape formula và quoting; download có media type/extension đúng. Không xuất report trước approval.
- SEO UI có connection/property/date/filter/import/datasets/insights/preview/execution/approval/report thật. OAuth controls disabled khi thiếu config, không giả Connected. GSC và AI modes hiển thị độc lập.

## File/tài liệu

Migrations `0004_gsc_seo_datasets.sql` và snapshot; 18 bảng. `packages/integrations`: gsc-http/client/oauth/runtime, token-crypto, seo-data. `packages/shared/seo.ts`; workspace seo-insights/handlers/template. Core chỉ mở rộng execution context, goal policy hook, Retry-After và optional report renderer; không import nghiệp vụ SEO. Provider structured schemas/capabilities mở rộng, mock giữ cho tests.

`src/app/api/gsc/[...path]/route.ts`, `src/components/seo-workspace.tsx`; browser runner/preload, gsc support/unit/integration/E2E, verify-phase3/gsc-smoke. README/ARCHITECTURE/DATABASE_SCHEMA/ROADMAP/TASKS cập nhật; thiết kế ở `docs/phase3/DESIGN.md`.

## Giới hạn còn lại và điều kiện Phase 4

Chưa kiểm chứng endpoint/account/quota/property trên Google thật; chưa hai AI APIs thật hoặc đối soát invoice. GSC trả top rows và ẩn truy vấn nên tổng ở đây là tổng các dòng thu thập, không phải property total. Cap 50.000 dòng mỗi kỳ, 5.000 mỗi page; có warning khi chạm cap. Hai kỳ cùng filters, cùng độ dài và không chồng lấn; không nội suy missing rows thành nguyên nhân SEO. Import chỉ hỗ trợ schema CSV/JSON công bố, không tự đoán các sheet/locale/ZIP export khác. AI reasoning là evidence triage trong enum/schema, không arbitrary SEO agent hoặc free-form strategy writer. Legacy upload của New Goal vẫn chỉ lưu bytes; SEO import là luồng đọc file riêng đã triển khai.

Phase 4 chỉ chuyển sau khi: cấu hình Google OAuth thật + consent/property read, lấy snapshot qua worker và chạy `verify:gsc -- --dataset=<id>` để lưu official execution evidence; cấu hình ít nhất hai AI APIs/model/giá, cấp phép paid calls riêng, chạy phân tích/AI2 validation và human approval/final reports thật. `verify:gsc` chỉ xác minh stored execution, không ngầm gọi AI/network mới; `verify:live` thuộc Phase 2 và vẫn BLOCKED.

Production hardening chưa triển khai: OIDC/multi-user/session lifecycle, OAuth/security review, HTTPS/secure cookies, stable secret/encryption key management, object storage/retention, backup + restore drills, monitoring, deployment/quota Google Cloud. Development auth không được public. Không mở website write/publish trong Phase 4 nếu chưa có quyền, approval, before/after và rollback thiết kế riêng.

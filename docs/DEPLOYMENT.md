# Triển khai staging ORBIT

Đã kiểm chứng production build trong Docker local qua HTTPS, không triển khai Internet. Bảy packages, engine và SEO workflow được kế thừa. GSC/AI LIVE cần nghiệm thu riêng. Không dùng `npm run dev` làm public server.

## Local staging đã kiểm thử

Yêu cầu Linux Docker Engine + Compose ≥2.24.4, Node 24; ít nhất 4 GB RAM và đủ disk cho image/database/backup. Browser checks cần Chromium/Chrome và `certutil` (`libnss3-tools`). Runtime image dùng UID 1000; files secrets cần cho UID này đọc, giữ thư mục 0700/files 0600. macOS/Windows dùng Docker Desktop/WSL; chưa nghiệm thu trên hai hệ điều hành đó.

```sh
npm ci
npm run setup:local
npm run verify:phase4
```

Runner tạo project `orbit-phase4-local`, secrets ngẫu nhiên trong `.orbit/staging`, account fixture được provision rõ ràng cho kiểm thử. Account fixture này không nằm trong code hoặc production seed. Ingress chỉ bind loopback; không có link public để xem bằng điện thoại. Browser test tin CA local bằng NSS tạm thời và gỡ certificate của test sau khi chạy; không bỏ qua xác minh TLS.

Chạy staging cho dữ liệu riêng bằng config/project khác, không dùng fixture runner cho database thật:

```sh
node ops/create-staging-config.mjs .orbit/staging-personal
# Tạo hai image từ Dockerfile và Dockerfile.ops, đặt tag cố định trong staging.env.
# Dùng cùng --env-file, -p và -f cho TẤT CẢ các lệnh bên dưới.
docker compose --env-file .orbit/staging-personal/staging.env -p orbit-personal -f compose.staging.yml up -d db migrate grants storage-init
docker compose --env-file .orbit/staging-personal/staging.env -p orbit-personal -f compose.staging.yml run --rm -T provision provision --email=YOUR_ADMIN_EMAIL --password-file=/run/secrets/bootstrap_password
docker compose --env-file .orbit/staging-personal/staging.env -p orbit-personal -f compose.staging.yml up -d --wait web worker tls backup
```

Admin lấy mật khẩu ban đầu qua file private do mình quản lý, không gửi vào chat/log. Sau đăng nhập đầu tiên đổi bằng CLI provision đọc password từ stdin hoặc file private. Không có signup/password-reset email; account management là CLI. Development seed bị chặn khi ORBIT_ENV=staging/production. Provision `--adopt-owner=<UUID>` chỉ để nhận lại account Phase 3 chưa có password hash; giữ nguyên ID/data, không tạo owner mới rồi bỏ dữ liệu cũ.

Build dùng digest pinned. Trong managed environment có proxy CA, truyền BuildKit `--secret id=proxy_ca,src=...` từ biến CA đã cấp; không đưa CA key, API secret, `.env` hoặc `.orbit` vào build context. Không tắt TLS verification.

## Chọn hosting và chi phí dự kiến

Phương án phù hợp quy mô cá nhân: **một Linux VM 2 vCPU/4 GB RAM, disk 40–60 GB**, Docker Compose và domain/subdomain riêng. PostgreSQL, worker, artifacts và backup chạy bền vững trên VM. Khi tắt Windows/Mac, worker vẫn chạy nếu VM hoạt động. Có thể dùng VM Google Cloud sẵn có nếu quyền/region/quota cho phép; chưa có bằng chứng project hay quyền cloud hiện tại.

Dự toán tham khảo, chưa phải báo giá: khoảng **15–35 USD/tháng** cho VM nhỏ tùy hãng/region, cộng disk, IPv4, traffic và backup ngoài máy có thể thêm **5–15 USD/tháng**; domain khoảng **10–25 USD/năm**, có thể dùng subdomain đã sở hữu. Google Cloud giá thực tế có thể cao hơn khoảng này. Cần kiểm tra calculator theo region và ngân sách trước khi tạo tài nguyên. Không giả định miễn phí từ mức RAM của ứng dụng khác. Cloud Run + Cloud SQL cần thiết kế worker/storage và có chi phí nền riêng, chưa phải cấu hình đã nghiệm thu ở đây. API AI tính phí độc lập; thuê bao chat không đồng nghĩa credit API.

## Điều kiện trước public

Người dùng cần xác nhận hosting/project/region, ngân sách, domain/subdomain và DNS, admin email và cho phép public deployment. Secrets được cung cấp trong secret store/file private trên host, không trong chat. Cần nơi giữ backup ngoài VM và backup key độc lập. Nếu dùng VM có sẵn, xác minh quyền, dung lượng, firewall và các dịch vụ khác trước khi thay đổi.

`compose.public.yml` + `deploy/Caddyfile.public` chỉ là cấu hình chuẩn bị. Sau phê duyệt, đổi ORBIT_BASE_URL thành HTTPS origin thật, ORBIT_HOSTNAME thành DNS name, cấu hình DNS + firewall 80/443; dùng overlay public để Caddy xin certificate ACME. PostgreSQL/web/worker không mở port trực tiếp. Chạy security gates trước mở firewall. OAuth redirect phải trùng origin thật; secrets integration chỉ mount bằng overlay `compose.integrations.yml`. Không có API call chỉ vì mount key. LIVE probes chỉ chạy sau consent rõ ràng.

Public overlay/ACME, DNS, VM provisioning, cloud IAM, backup offsite và fresh-host deployment chưa chạy. Không suy ra PRODUCTION READY từ local staging.

## Update / rollback

1. Xem runbook backup, tạo encrypted backup và xác minh restore trước update. Ghi image digest app/ops hiện hành.
2. Pull/build image tag bất biến. Dừng web/worker, chạy `migrate` rồi `grants`, khởi động lại web/worker/TLS/backup và kiểm tra readiness, login, MOCK goal/approval/download.
3. Nếu chỉ lỗi app và schema còn tương thích, đổi ORBIT_IMAGE về digest cũ rồi recreate web/worker. Không downgrade migration tự động.
4. Nếu schema/data không tương thích, giữ dịch vụ dừng; restore backup vào database và artifact volume MỚI theo [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md), chọn lại database/storage và image tương thích. Không ghi đè database hiện tại hoặc dùng `down -v`.

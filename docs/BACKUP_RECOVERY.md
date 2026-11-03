# Backup, restore và rotation

## Backup tự động

Service `backup` chạy ngay khi khởi động rồi mỗi 24 giờ, retry 5 phút khi lỗi; health fail nếu lần thành công cuối quá 26 giờ. `flock` chống hai backup đồng thời và tự nhả khi process chết. Giữ 7 bản thành công gần nhất; file `.pending-*` chưa hoàn tất không được restore hoặc tính thành công. Logs lỗi không chứa PGPASSWORD. Dump dùng PostgreSQL 17 `pg_dump -Fc --no-owner --no-acl`; artifact blobs bất biến được chụp sau DB snapshot để không thiếu blob đã được commit. Không chạy orphan cleanup trong lúc backup.

Archive pg_dump + artifacts được AES-256-GCM mã hóa, AAD bind backup ID, manifest ghi checksum/bytes/IV/tag/key fingerprint. Backup key riêng 32-byte base64, không dùng token/session key. Plaintext chỉ ở tmpfs riêng trong container trong quá trình dump/decrypt; không ghi plaintext vào persistent backup volume. Dung lượng tmpfs 1 GB, cần tăng khi dataset/database lớn hơn. Artifact volume readonly đối với backup. Backup privileged DB credential chỉ nằm trong service này.

Backup volume cùng VM **không phải disaster recovery**. Chưa cấu hình offsite transfer/KMS/immutable remote retention. Trước dùng dữ liệu quan trọng, operator cần copy encrypted backups ra storage tách VM, lưu backup key + token encryption key trong vault riêng, thử restore từ bản offsite. Không gửi keys vào chat/log. Mất backup key không giải mã archive; mất token key có thể cần Google reauthorization dù DB restore được.

## Lệnh vận hành

Trong các lệnh dưới, dùng cùng `--env-file <private staging.env> -p <project> -f compose.staging.yml`; gọi tắt là `docker compose` chỉ để dễ đọc.

```sh
docker compose exec backup node /opt/orbit/backup.mjs once
docker compose exec backup node /opt/orbit/backup.mjs health
# Chọn ID từ last-success.json; chỉ metadata, không chứa secret.
docker compose exec backup cat /backups/last-success.json
# Target bắt buộc orbit_restore_..., không tồn tại trước đó.
docker compose run --rm restore restore BACKUP_ID orbit_restore_YYYYMMDD
```

Restore kiểm tra SHA-256 và GCM authentication hoàn toàn trước tar extraction/database creation; chỉ cho member database.dump và hash blob filenames, verify từng artifact hash. Không restore đè DB. Artifact target `/restore-artifacts` phải trống, volume tách nguồn. Sau restore, sessions/OAuth states/worker heartbeats bị xóa; QUEUED/RUNNING runs chuyển PAUSED. Không tự bật LIVE sau restore. Một lỗi pg_restore có thể để target database dở dang: giữ nguồn, xem lỗi, bỏ target disposable sau xác minh và restore vào target mới.

Drill automated: `npm run test:backup`, chỉ cho local project `orbit-phase4-*`; tạo target ngẫu nhiên rồi xóa đúng target test. Thực sự pg_dump/decrypt/pg_restore, kiểm đếm runs, hash artifacts, session invalidation, checksum corruption và từ chối target trùng. Bằng chứng `docs/evidence/phase4-backup-restore.json`. Sau restore vào host mới vẫn phải nghiệm thu login/MOCK run/readiness trước cutover; drill local không thay thế offsite/fresh-host test.

## Token key rotation

1. Backup/restore drill, dừng web/worker, giữ bản cũ private. Tạo active key 32-byte base64 mới bằng công cụ secret an toàn; không in key ra terminal/log.
2. Thay `secrets/token_key` bằng key mới. Đặt key cũ vào file `integrations/ORBIT_TOKEN_ENCRYPTION_PREVIOUS_KEY` (0700 directory/0600 file); dùng overlay `compose.integrations.yml` cho maintenance.
3. `docker compose ... -f compose.integrations.yml run --rm provision rotate-tokens`. CLI rewrap tất cả access/refresh tokens trong một transaction, invalidate pending OAuth states; corrupt row rollback toàn bộ. Không gọi Google/AI.
4. Bỏ previous key khỏi mount/runtime sau thành công, khởi động lại web/worker với active key, kiểm tra health/status. Lưu key cũ riêng cho các encrypted backups cũ; không để previous key online lâu dài.
5. Nếu rewrap lỗi, dừng và điều tra; giữ file/key cũ, không xóa dữ liệu. Có thể quay lại active key cũ vì transaction đã rollback.

API keys: thay đúng optional integration file, recreate web/worker; probes bị invalidated do fingerprint binding. DB password: dừng services, đổi file và ALTER ROLE qua admin tooling, chạy grants/recreate; POSTGRES_PASSWORD_FILE không tự đổi role đã tồn tại. Backup key: tạo secret mới cho bản backup mới, giữ key cũ offline cho archive cũ; restore phải chọn key đúng fingerprint. Không có automated cloud KMS rotation ở Phase 4.

## Artifact retention

Không xóa báo cáo/dataset đang được tham chiếu theo tuổi. CLI `provision artifact-retention` dry-run mặc định; giữ references từ artifacts, normalized/raw datasets và GSC page checkpoints. Chỉ orphan/.pending quá 7 ngày là candidate. `--apply` cần maintenance confirmation, web/worker dừng và không có worker heartbeat active. Cấm apply khi backup hoặc import/execution đang chạy. Giữ database/history và rollback data cho tới khi operator có chính sách riêng; không tự xóa user content.

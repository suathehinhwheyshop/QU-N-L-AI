# ORBIT localhost trên Windows 10

Mục tiêu hiện tại: **bản Codex độc lập với bản ORBIT Claude tại 3210**; một chủ tài khoản, web ở `http://127.0.0.1:3211`, web/worker chạy trong WSL2, PostgreSQL + backup qua Docker Desktop. Không public staging, VPS, Google Cloud hoặc REST API key tính phí. Máy/WSL phải hoạt động; sau restart các workflow đang chạy/chờ chạy bị PAUSED và cần Resume thủ công.

Dùng **checkout Codex riêng** (`/home/TEN/ORBIT-Codex`), không dùng chung thư mục nguồn/node_modules với ORBIT Claude. Installer/updater chạy npm ci trong checkout được chọn. Dữ liệu mới `.orbit/codex`, image `orbit-ops:codex-local`, database `orbit_codex` trong Docker project riêng; build Next ở `.next-codex`. Cookie `orbit_codex_session` và OAuth nonce riêng tránh ghi đè cookie của app 3210. Cookie cùng host không phải sandbox chống một ứng dụng local độc hại; ở đây bảo vệ hai bản ứng dụng tin cậy khỏi ghi đè ngoài ý muốn.

Config cũ dùng port 3210/project orbit-personal bị từ chối, không tự migrate, copy secrets hoặc reset dữ liệu. Không trỏ ORBIT_LOCAL_DIR vào profile Claude/cũ. Port 3211 bận thì start báo lỗi, không chiếm/kill tiến trình khác hoặc tự đổi về 3210.

## Trạng thái kiểm chứng

Install/start/stop/restart/manual resume/backup/restore đã chạy trên Linux với Docker thật; **chưa chạy trên Windows 10/WSL2 thật** vì môi trường phát triển hiện là Linux. PowerShell wrapper, Bash bridge và Windows manual checklist được cung cấp để nghiệm thu trên máy người dùng. Không coi Linux equivalent hoặc CLI_STUB là Windows/LIVE verification. Node private của Codex ở ~/.local/share/orbit-codex/node24. Node bootstrap tải bản chính thức 24.22.2, kiểm SHA-256 pin và đã được thử riêng.

## Chuẩn bị một lần

1. Windows 10 x64 22H2 build 19045 trở lên, bật virtualization. Tài liệu Docker hiện tại nêu WSL ≥2.1.5 và 8 GB RAM; kiểm tra edition/build cùng phiên bản Docker Desktop đang được hỗ trợ trên máy. Không tự đổi OS hoặc cài Docker/WSL có quyền admin trong script ứng dụng.
2. Cài WSL2 + Ubuntu theo hướng dẫn Microsoft; nếu máy hỗ trợ, dùng PowerShell admin `wsl --install -d Ubuntu`, restart khi Windows yêu cầu, tạo user Linux. Kiểm tra `wsl --list --verbose` cho Ubuntu ở VERSION 2; `wsl --update` khi cần. Script từ chối WSL1.
3. Cài Docker Desktop, chọn WSL2 engine và bật **Settings → Resources → WSL Integration → Ubuntu**. Mở Docker Desktop. Trong Ubuntu, `docker info` và `docker compose version` phải chạy được; không tạo Docker daemon thứ hai trong Ubuntu. Không cấu hình Docker TCP public.
4. Cần Git, curl, xz/tar và CA certificates trong Ubuntu. Nếu thiếu: `sudo apt-get update` rồi `sudo apt-get install -y git curl xz-utils ca-certificates`. Node 24 được installer cài trong thư mục riêng của ORBIT nếu WSL chưa có Node ≥24; không thay system Node, HOME hay cấu hình Claude. Không tắt TLS/checksum verification.

Nguồn chính thức: [Docker Windows install](https://docs.docker.com/desktop/setup/install/windows-install/), [Microsoft WSL install](https://learn.microsoft.com/windows/wsl/install), [Node 24.22.2 checksums](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt). Trong lượt phát triển, Docker requirements đã đọc từ repo `docker/docs`; Windows prerequisite acceptance vẫn chưa được xác minh trên máy thật.

## Cài ORBIT

Clone trong Linux filesystem `/home/<user>/ORBIT`, tránh `/mnt/c` để giữ quyền files 0600/0700 và hiệu năng. Thay TEN bằng username Ubuntu thực tế:

```sh
git clone --branch orbit/local-readiness-followup https://github.com/suathehinhwheyshop/QU-N-L-AI.git /home/TEN/ORBIT-Codex
```

Trong PowerShell Windows:

```powershell
& '\\wsl$\Ubuntu\home\TEN\ORBIT-Codex\ops\windows\Install.ps1' -Repository '/home/TEN/ORBIT-Codex' -Distribution Ubuntu -OwnerEmail 'email-cua-anh@example.com'
```

Nếu chính sách PowerShell của máy chặn script, dùng chính sách cho phép script nguồn đã kiểm tra theo quy định của máy; không vô hiệu hóa bảo mật toàn hệ thống. Có thể chạy lệnh tương ứng ngay trong Ubuntu: `bash ops/windows/bridge.sh install /home/TEN/ORBIT-Codex --email email-cua-anh@example.com`.

Installer kiểm Docker/Node, tạo private profile, `npm ci`, migration + DB grants, provision đúng một owner, hỏi mật khẩu **trong terminal và không echo**, production build và image backup. Không có signup/demo password. Không gửi password/token vào chat. Lần cài lại giữ profile/owner/dữ liệu hiện có; không seed/reset PostgreSQL. Lỗi build/prerequisite phải giải quyết trước khi start.

Profile `.orbit/codex` (ignored): `config.json` chứa owner UUID/project/database/path; `secrets/` chứa DB/session/encryption/backup keys; `artifacts/`, `backups/`, `restores/` và `cli/` riêng. Không xóa thư mục này khi update. Database Docker volume tên theo project `orbit-codex-<id>`. Web/worker dùng DB roles riêng, artifacts/checkpoints bền vững; worker heartbeat và single-worker lease chống chạy hai worker local. Config được ghi atomically.

## Thao tác thường dùng

```powershell
$Orbit = '\\wsl$\Ubuntu\home\TEN\ORBIT-Codex\ops\windows\Orbit.ps1'
& $Orbit -Action doctor -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action start -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action status -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action stop -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action restart -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action update -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action backup -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action restore -Repository '/home/TEN/ORBIT-Codex' -BackupId 'ID_TRONG_BACKUPS'
```

`doctor` dùng được trước install nếu Node 24 đã có trong WSL. Nếu chưa có Node, bridge báo prerequisite và hướng dẫn dùng installer/bootstrap như trên; không tự cài từ lệnh chẩn đoán. Báo cáo JSON chỉ đọc: kernel WSL2, Node, Docker Linux/Compose v2, profile Codex, metadata quyền file secrets, port 3211/55435. File secrets không được mở nội dung; profile legacy/invalid bị giữ nguyên. Port bận chỉ được công nhận là của ORBIT khi PID/start-time/argv riêng hoặc Docker project/service/loopback mapping khớp; trường hợp khác báo BLOCKED, không kill process. Không mở/đổi port 3210, không cài/migrate/restore hoặc gọi AI. `LOCAL_PREREQUISITES_PASS` không phải nghiệm thu Windows hoặc AI LIVE; cần làm checklist máy thật bên dưới.

Distro khác Ubuntu: thêm `-Distribution <tên chính xác>`. Start mở dịch vụ, người dùng truy cập IPv4 loopback `127.0.0.1:3211` trên Windows. Không bind `0.0.0.0`; truy cập điện thoại/LAN không thuộc chế độ này. Nếu WSL localhost forwarding trên máy bị tắt, sửa cấu hình WSL chính thức và nghiệm thu loopback; không mở port LAN để né lỗi.

Stop dừng web/worker có grace rồi backup/DB containers, giữ volumes và files. Restart không tự Resume workflow; thao tác Resume/Cancel/Approval trong UI. Worker bị kill/mất điện: durable leases/fencing xử lý attempt cũ, startup pause chặn tác vụ mới; read-only checkpoint đã commit được giữ. Máy tắt không có tiến trình cloud chạy thay.

Update yêu cầu Git working tree sạch, backup trước, dừng dịch vụ, `git pull --ff-only`, frozen dependencies/migrate/grants/build app và backup image. Không merge main, reset hoặc xóa volumes; không tự restart/resume sau update. Nếu update lỗi, dữ liệu nguồn còn và có backup; xem private logs, chọn image/code/schema tương thích trước start. Không auto downgrade schema.

Backup mã hóa AES-256-GCM gồm pg_dump và immutable artifact blobs, chạy ngay khi backup service khởi động rồi mỗi 24 giờ khi máy/WSL bật, giữ 7 bản. Không bao gồm CLI login cache hoặc encryption/backup keys: lưu keys riêng an toàn, đăng nhập lại khi chuyển máy. Backup cùng máy chưa chống mất cả ổ đĩa; người dùng tự giữ bản encrypted và keys ở nơi tách biệt. Restore yêu cầu ORBIT dừng, chọn archive ID từ thư mục `backups`, xác thực trước tạo database/thư mục artifact **mới**, verify hashes, revoke sessions và pause active runs; giữ nguồn và `previous-config.json`. Không dùng `docker compose down -v`.

## Provider của chủ tài khoản

Mặc định chỉ **Claude Max 5x, ChatGPT và Grokbot**. Chỉ Codex CLI được cài bởi `install-cli`; Gemini được giữ optional/disabled và không được quảng bá hoặc bật tự động.

```powershell
& $Orbit -Action install-cli -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action login-codex -Repository '/home/TEN/ORBIT-Codex'
& $Orbit -Action check-codex -Repository '/home/TEN/ORBIT-Codex'
```

Đăng nhập chính thức ChatGPT qua CLI; không copy OAuth token/cookie và không nhập API key. CLI profile riêng `.orbit/codex/cli`, không đọc/sửa profile Claude. Login không gửi prompt và không tự tạo CONNECTED.

`check-codex` chỉ đọc account/quota qua app-server chính thức, không gửi prompt. Chưa đăng nhập trả `NOT_SIGNED_IN`, usage `null`. Khi có ChatGPT login, chỉ hiện các windows/usedPercent/reset do CLI cung cấp; không tự suy đoán quota còn lại. Email/account ID/credit balance/raw CLI output không được in hoặc lưu DB. Lệnh không thay billing, không tiêu reset credit và không mở gate LIVE. Cần cài ORBIT + `install-cli` trước lệnh này.

**Hiện LIVE vẫn BLOCKED:** Codex adapter/headless/schema đã có code và CLI_STUB tests, nhưng cơ chế chỉ dùng quota bao gồm thay vì credits/extra usage chưa được kiểm chứng/thi hành chính thức. App chặn real probe/invoke bằng CLI_INCLUDED_ALLOWANCE_UNVERIFIED trước prompt; không có env flag để tự xác nhận. Không bật overage/top-up/billing. Claude Max5x qua ORBIT/Agent SDK còn BLOCKED eligibility. Grokbot→official Grok Build entitlement còn BLOCKED; community Grok CLI/xAI API trả phí không được dùng thay.

AI & Kết nối hiển thị đúng ba provider và blocker, không báo Connected khi chỉ cài/login. Remaining quota không tự suy đoán. Hai-AI LIVE không chạy khi chưa có hai eligible vendors; không bù bằng Gemini hoặc API. Offline MOCK workflows vẫn dùng engine/checkpoints/approval/reports để kiểm tra localhost.

## Checklist trên Windows thật còn chờ

- Install từ PowerShell với WSL2/Docker Desktop và Node bootstrap, không có password echo.
- Windows browser mở đúng 127.0.0.1, login/logout/unauthorized/CSRF, connection statuses.
- MOCK goal → approval → artifacts; stop/restart hoặc reboot không tự Resume, checkpoint/checksum còn.
- Backup → restore fresh target → login và tải lại reports; thử update fast-forward trên branch sạch.
- Kiểm UI đúng Claude Max5x/ChatGPT/Grokbot, Gemini không xuất hiện; real calls bị chặn khi entitlement/included-only gate chưa verified.
- Chỉ mở nghiệm thu LIVE sau khi có cơ chế official only-included đã được kiểm chứng và consent của người dùng; không paid API/billing changes.

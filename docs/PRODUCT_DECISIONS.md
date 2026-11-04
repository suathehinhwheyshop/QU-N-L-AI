# Quyết định sản phẩm ORBIT

## Bổ sung triển khai — 04/11/2026

Giữ nguyên ba provider và namespace Codex 3211. Thêm `doctor` chỉ đọc metadata/điều kiện local và `check-codex` đọc account/quota qua app-server chính thức của Codex 0.166.0. Không tạo thread/turn, không tiêu reset credits, không suy diễn quota còn lại hoặc quyền billing. Đọc được account/quota không mở gate included-only và không tạo CONNECTED/LIVE receipt. Account reader loại identity/email/account ID/credits balance khỏi output và không lưu vào DB. Xem LOCAL_READINESS_VALIDATION.md; Windows thật và subscription inference tiếp tục BLOCKED.

## Quyết định hiện hành — provider correction, 03/11/2026

Chủ dự án chỉ dùng **Claude Max 5x, ChatGPT và Grokbot**. Gemini giữ optional/disabled, ngoài UI/install/login/probe/router mặc định; không dùng Gemini hoặc xAI API để thay provider thiếu. Không API key tính phí, không tự bật overage/top-up/usage billing, không scraping/token/session extraction.

Bản ORBIT Codex dùng **127.0.0.1:3211**, PostgreSQL loopback 55435, profile `.orbit/codex`, Docker project `orbit-codex-<id>`, volume/secrets/artifacts/checkpoints/CLI profiles và cookies riêng. Bản ORBIT Claude ở 3210 được giữ nguyên. Dùng checkout Codex riêng; không trỏ installer/updater vào codebase Claude. Legacy 3210 profile bị từ chối và không tự migrate/reset.

ChatGPT giữ Codex CLI adapter/official login; interface và CLI_STUB được kiểm, LIVE BLOCKED khi chưa xác minh included-only enforcement/account execution. Claude Max5x qua ORBIT/SDK và Grokbot→official Grok Build entitlement còn BLOCKED; có official Grok Build headless, không suy ra gói Grokbot tương thích. Không cài/sửa Claude Code hoặc billing. Hai-AI LIVE cần hai vendors đủ quyền, không tự vượt gate.

Xem SUBSCRIPTION_AI_INTEGRATION.md, LOCAL_SETUP_WINDOWS.md và PROVIDER_CORRECTION_VALIDATION.md. Các phần dưới giữ lịch sử, không ưu tiên hơn quyết định này.

## Quyết định trước provider correction — Windows localhost/subscription-only

Chủ dự án chốt Windows 10/WSL2/Docker Desktop, single owner và 127.0.0.1; không public staging, VPS/Google Cloud hoặc REST API key có phí riêng. Chỉ dùng cơ chế đăng nhập chính thức/quyền/hạn mức của gói AI cho phép, không scraping/cookie/session extraction/API giả. Không tự Resume workflow sau reboot. Không thay đổi codebase/profiles Claude Code.

Thực hiện Local Mode trước, Codex CLI rồi Gemini CLI; Claude Code chỉ khi eligibility được xác minh, hiện BLOCKED; Grok UNSUPPORTED trong subscription mode hiện tại. Hai adapter được kiểm bằng CLI_STUB không chứng minh LIVE. Windows10 và inference bằng login thật còn cần nghiệm thu trên máy người dùng; không yêu cầu token/password trong chat. Xem LOCAL_SETUP_WINDOWS.md, SUBSCRIPTION_AI_INTEGRATION.md và LOCAL_SUBSCRIPTION_VALIDATION.md.

Ghi chú ban đầu dưới đây giữ lịch sử; quyết định cuối này có ưu tiên cao hơn các kế hoạch public/API trước đó.

## 03/11/2026 — localhost và quyền sử dụng từ các gói AI hiện có

Yêu cầu của người dùng: “Anh làm webapp dạng localhost để dùng token sẵn ở chat của các gói AI đã đăng ký.”

ORBIT ưu tiên chạy trên máy cá nhân, dùng cho riêng chủ tài khoản. Mục tiêu là tận dụng hạn mức/token đã bao gồm trong các gói AI đang trả phí, giảm thao tác chuyển dữ liệu và giao việc giữa các AI. Public hosting/cloud không phải mục tiêu ưu tiên hiện tại. Worker localhost cần máy và tiến trình hoạt động để thực thi; đồng bộ Windows/macOS chưa được giải quyết bởi thay đổi định hướng này.

“Token sẵn ở chat” được ghi nhận là hạn mức sử dụng của thuê bao; chưa có bằng chứng đó là API credential có thể chuyển vào ORBIT. Mỗi provider cần kiểm tra cơ chế đăng nhập chính thức, quyền của gói và khả năng tự động giao việc/nhận kết quả qua ứng dụng, CLI hoặc SDK được hỗ trợ. Không mặc định thuê bao chat cấp quyền REST API hoặc cho phép dùng cookie/session của giao diện chat làm API key. Đăng nhập và credentials được xử lý trên máy, qua cơ chế được provider hỗ trợ; không lưu secrets trong frontend, repository hoặc logs.

Giữ ORBIT Core, bảy packages, workflow, approvals và mock adapters hiện có. Adapter cho từng cơ chế đăng nhập phải độc lập với engine. Không mặc định truy cập được projects, agents hoặc lịch sử chat chỉ vì tài khoản đã đăng nhập. Chỉ ghi CONNECTED/LIVE khi có bằng chứng thực thi thật.

Trạng thái lúc ghi chú: code hiện có là REST API adapters cần API credentials riêng, cùng mock cho kiểm thử. Chưa có adapter dùng đăng nhập/thuê bao chat được triển khai hoặc kiểm chứng. Đây là yêu cầu định hướng cho bước tiếp theo; không thay đổi kết quả nghiệm thu Phase 1–4 đã lưu, không cấp phép gọi API trả phí hoặc triển khai Internet.

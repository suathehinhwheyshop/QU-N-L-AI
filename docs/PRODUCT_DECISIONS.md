# Quyết định sản phẩm ORBIT

## Quyết định cuối — Windows 10 localhost và subscription-only

Chủ dự án chốt Windows 10/WSL2/Docker Desktop, single owner và 127.0.0.1; không public staging, VPS/Google Cloud hoặc REST API key có phí riêng. Chỉ dùng cơ chế đăng nhập chính thức/quyền/hạn mức của gói AI cho phép, không scraping/cookie/session extraction/API giả. Không tự Resume workflow sau reboot. Không thay đổi codebase/profiles Claude Code.

Thực hiện Local Mode trước, Codex CLI rồi Gemini CLI; Claude Code chỉ khi eligibility được xác minh, hiện BLOCKED; Grok UNSUPPORTED trong subscription mode hiện tại. Hai adapter được kiểm bằng CLI_STUB không chứng minh LIVE. Windows10 và inference bằng login thật còn cần nghiệm thu trên máy người dùng; không yêu cầu token/password trong chat. Xem LOCAL_SETUP_WINDOWS.md, SUBSCRIPTION_AI_INTEGRATION.md và LOCAL_SUBSCRIPTION_VALIDATION.md.

Ghi chú ban đầu dưới đây giữ lịch sử; quyết định cuối này có ưu tiên cao hơn các kế hoạch public/API trước đó.

## 03/11/2026 — localhost và quyền sử dụng từ các gói AI hiện có

Yêu cầu của người dùng: “Anh làm webapp dạng localhost để dùng token sẵn ở chat của các gói AI đã đăng ký.”

ORBIT ưu tiên chạy trên máy cá nhân, dùng cho riêng chủ tài khoản. Mục tiêu là tận dụng hạn mức/token đã bao gồm trong các gói AI đang trả phí, giảm thao tác chuyển dữ liệu và giao việc giữa các AI. Public hosting/cloud không phải mục tiêu ưu tiên hiện tại. Worker localhost cần máy và tiến trình hoạt động để thực thi; đồng bộ Windows/macOS chưa được giải quyết bởi thay đổi định hướng này.

“Token sẵn ở chat” được ghi nhận là hạn mức sử dụng của thuê bao; chưa có bằng chứng đó là API credential có thể chuyển vào ORBIT. Mỗi provider cần kiểm tra cơ chế đăng nhập chính thức, quyền của gói và khả năng tự động giao việc/nhận kết quả qua ứng dụng, CLI hoặc SDK được hỗ trợ. Không mặc định thuê bao chat cấp quyền REST API hoặc cho phép dùng cookie/session của giao diện chat làm API key. Đăng nhập và credentials được xử lý trên máy, qua cơ chế được provider hỗ trợ; không lưu secrets trong frontend, repository hoặc logs.

Giữ ORBIT Core, bảy packages, workflow, approvals và mock adapters hiện có. Adapter cho từng cơ chế đăng nhập phải độc lập với engine. Không mặc định truy cập được projects, agents hoặc lịch sử chat chỉ vì tài khoản đã đăng nhập. Chỉ ghi CONNECTED/LIVE khi có bằng chứng thực thi thật.

Trạng thái lúc ghi chú: code hiện có là REST API adapters cần API credentials riêng, cùng mock cho kiểm thử. Chưa có adapter dùng đăng nhập/thuê bao chat được triển khai hoặc kiểm chứng. Đây là yêu cầu định hướng cho bước tiếp theo; không thay đổi kết quả nghiệm thu Phase 1–4 đã lưu, không cấp phép gọi API trả phí hoặc triển khai Internet.

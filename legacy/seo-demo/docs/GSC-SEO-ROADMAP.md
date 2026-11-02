# Orbit cá nhân — lộ trình GSC đến tối ưu website

## Mục tiêu và phạm vi

Một người dùng, ban đầu một website, một lệnh. Giữ giao diện Orbit. Grokbot lấy GSC và thao tác website; Claude phân tích; Orbit điều phối và lưu bảng việc. Chưa cần Linear, billing, quản lý khách hàng hay hệ thống thương mại. ChatGPT, ảnh/video và các quy trình khác để sau.

Hiện tại chỉ có prototype tương tác. Mọi dữ liệu, thay đổi và kiểm tra là mô phỏng. Không có kết nối AI/GSC/CMS, đăng nhập, đồng bộ cloud hay bộ chạy nền. Model/profile trong form là yêu cầu cấu hình, chưa phải model/project thật được xác minh.

## 1. Giao diện và mô phỏng (đã xây, kiểm tra theo README)

- Điều phối sáu bước, hiển thị bên nhận việc và đầu ra từng bước.
- Form mục tiêu, website, ngày dữ liệu, hồ sơ/model Claude và phạm vi được phép sửa.
- Bảng việc có URL, lý do, trước/sau, tiêu chí hoàn thành, trạng thái và ghi chú.
- Hồ sơ dữ liệu xuyên suốt, nhật ký, xuất JSON và CSV có BOM để mở Excel.
- Tạm dừng/tiếp tục, thử lỗi xuất GSC và chạy lại đúng bước; việc ngoài phạm vi bị chặn.
- Dữ liệu lưu localStorage riêng của bản SEO, không ghi đè dữ liệu bản Orbit cũ. Không đồng bộ hai máy.

Điều kiện: chạy hết luồng mô phỏng; thử lỗi không làm chạy các bước sau; tải lại không mất đầu ra đã có; không tuyên bố website đã sửa hoặc SEO tăng.

## 2. Xác minh kết nối và cấu hình cá nhân

Cần link/tên chính xác Grokbot, tài liệu hoặc khả năng nhận nhiệm vụ/đọc trạng thái/nhận đầu ra. Xác định CMS, quyền sửa, website thử phù hợp, hồ sơ/model/hướng dẫn Claude và cách anh đang bàn giao qua Gmail. Kiểm tra loại dịch vụ Google Cloud hiện có và quota thực tế trước khi chọn kiến trúc hoặc dự toán.

Ưu tiên kết nối chính thức nếu tài khoản hiện tại hỗ trợ. Không coi thuê bao chat là quyền API hoặc quyền truy cập project. Nếu chỉ có giao diện web, thử tiện ích/bộ chạy trên máy anh; không hứa tự động hóa ổn định trước khi kiểm chứng. Không lấy hoặc đưa cookie/mật khẩu vào web app. Quyền và cấu hình được thiết lập một lần; công việc trong phạm vi không phải xin lại từng bước.

Điều kiện: Orbit giao một việc chỉ đọc, bên nhận xác nhận với mã tương quan và trả đầu ra; xác định chính xác model/project có dùng được hay không.

## 3. Lấy GSC thật

Orbit tạo yêu cầu có mã công việc, property, khoảng ngày, kỳ so sánh cùng số ngày, search type, country, device, dimensions, giới hạn dòng và cách phân trang. Grokbot xuất dữ liệu và trả file/đường dẫn cùng bộ thông số. Nếu qua Gmail, dùng thread/message ID và mã công việc để ghép đúng, không đọc nhầm file cũ.

Kiểm tra property, thời gian, ngày dữ liệu sẵn có, bộ lọc, định dạng, trường bắt buộc và file hoàn chỉnh. Ghi rõ dữ liệu tổng vs nhóm trang/truy vấn; không coi tổng các dòng top query là tổng property. Lưu bản gốc bất biến, checksum, nguồn và thời gian lấy. Thiếu dữ liệu thì chặn phân tích, không bịa số.

Điều kiện: đối chiếu báo cáo xuất với GSC cùng thông số. Xử lý file trùng và thử nhận sai khoảng ngày.

## 4. Claude phân tích và lập bảng việc thật

Gói đầu vào gồm nguồn GSC, bối cảnh website, hướng dẫn phân tích và model đã xác minh. Đầu ra có schema: phát hiện, bằng chứng, giả thuyết, mức chắc chắn, URL, đề xuất, ưu tiên, phạm vi và tiêu chí kiểm tra. GSC chỉ cho thấy hiệu suất tìm kiếm, chưa tự chứng minh lỗi kỹ thuật/nội dung; đề xuất cần xác minh trang trước khi áp dụng.

Orbit kiểm tra schema, domain và nguồn; tách thành việc có ID ổn định. Một kết quả nhận lại không tạo issue trùng. Bảng Orbit là nguồn trạng thái ban đầu; xuất CSV mở Excel. Nếu cần Excel/Sheets làm nguồn chỉnh sửa, xây kết nối hai chiều với version, khóa ghi và xử lý xung đột ở một bước riêng; CSV hiện tại không làm việc đó.

Điều kiện: một báo cáo thật sinh ra bảng việc có thể thực hiện, truy được mỗi đề xuất về nguồn và không nhân đôi khi nhận lại.

## 5. Thực hiện một thay đổi thật và xác minh

Bắt đầu một trang phù hợp. Việc phải có phạm vi cho phép, nội dung trước/sau đã xác định và tiêu chí hoàn thành. Lưu snapshot/revision trước khi sửa, xác định cách hoàn tác tương ứng CMS. Kiểm tra trang còn đúng nội dung gốc trước khi ghi (tránh ghi đè sửa tay mới). Grokbot thực hiện; bên kiểm tra đọc lại website để xác nhận, không chỉ tin tin nhắn “xong”.

Nội dung, kỹ thuật hoặc URL ngoài phạm vi thì để blocked; báo rõ điều kiện cần bổ sung, không tự mở rộng quyền. Sau lỗi giữa chừng phải kiểm tra thay đổi đã áp dụng chưa trước khi chạy lại.

Điều kiện: thay đổi xuất hiện thật, URL hoạt động, tiêu chí đạt, có chứng cứ và đã xác minh cách hoàn tác. Sau đó mới mở rộng số trang.

## 6. Một lệnh khép kín, lưu bền vững và Google Cloud

Thay bộ mô phỏng bằng bộ điều phối có lưu trữ bền vững và hàng đợi. Các trạng thái: queued → running → waiting_result → validating → completed / blocked / failed. Mỗi bước có job ID, attempt ID, idempotency key, hạn chờ và quyền nhận việc có thời hạn. Callback phải xác thực, ghép đúng job/attempt; bỏ qua kết quả đến muộn/đã xử lý. Có backoff, giới hạn retry và nhật ký; không chạy lặp thay đổi website khi callback gửi lại.

Bản máy bật: một local runner nhận việc từ web, giữ phiên công cụ cục bộ; offline thì để queued. Windows và Mac chỉ một máy được nhận một việc, không dựa vào localStorage để khóa liên máy.

Bản cloud: chỉ triển khai worker sau khi kết nối thực tế hỗ trợ chạy phía máy chủ. Web/worker không dựa vào một HTTP request kéo dài; công việc và kết quả tồn tại khi tiến trình khởi động lại. Tận dụng dịch vụ Google Cloud sẵn có sau khi xác minh loại dịch vụ, quota, quyền, vùng và khả năng chạy nền. Hiện chưa có dữ liệu đủ để cam kết miễn phí hoặc chọn sản phẩm cụ thể.

Báo cáo phân biệt hoàn thành sửa web với hiệu quả SEO. Ghi ngày áp dụng, lịch thu GSC sau đó và điều kiện so sánh; không gán mọi biến động thứ hạng cho thay đổi vừa thực hiện.

Điều kiện: một lệnh đi hết vòng trên một website; restart/offline không mất hoặc nhân đôi việc; bước lỗi tiếp tục đúng vị trí; báo cáo đúng những việc đã xác minh và những việc còn bị chặn.

# Phase 2 — phạm vi và bằng chứng

Baseline: branch orbit/phase1-foundation-audit, commit 9f07558652b1cf4be46c64d2ccaf23a55c311280. Đã chạy lại 14 unit + 10 integration + build + E2E, lưu riêng docs/evidence/phase1-baseline.

Giữ 7 packages và engine DAG/lease/checkpoint. Chỉ mở rộng adapter contract, admission LIVE, accounting và planning handler cần thiết. Không dùng hoặc sao chép Claude Code.

- Bốn adapter REST độc lập theo API chính thức: OpenAI chat completions, Anthropic Messages/tools, Gemini generateContent JSON, xAI OpenAI-compatible chat. HTTP proxy/CA giữ nguyên, không retry ngầm, không endpoint tùy ý từ client.
- Server secrets ORBIT_*_API_KEY; client chỉ thấy credential_present. Probe thực hiện structured inference; HTTP stub không được tạo CONNECTED/LIVE receipt.
- Model config cần giá operator cung cấp và token limits. Không bịa giá hay model entitlement. Lưu usage reported, tính giá ước tính và rounding theo cents để giới hạn ngân sách. Kết quả lỗi/timeout có thể đã tính tiền: không hoàn reservation như mock.
- AI planning chạy như model task có checkpoint/budget trong workflow, không gọi tính phí âm thầm ở preview. AI lập plan theo schema và allowlist các bước read-only của template; không tự thêm tool, bỏ approval hay thực thi mã. Template là fallback rõ nguyên nhân, không giả gọi AI thành công.
- LIVE Phase 2 dùng dữ liệu yêu cầu người dùng, không gọi GSC. SEO/GSC fixture không được nâng thành LIVE; GSC thật thuộc Phase 3.
- Test MOCK, HTTP_STUB, LIVE_API tách bằng evidence. Automated tests offline không đủ chứng minh LIVE.

Hiện tại cả bốn key đều vắng mặt và egress API chưa được áp dụng. Hoàn thiện code và tests độc lập, báo live smoke BLOCKED nếu chưa có bằng chứng thực tế. Không tuyên bố Phase 2 đã nghiệm thu LIVE chỉ vì stub passed.

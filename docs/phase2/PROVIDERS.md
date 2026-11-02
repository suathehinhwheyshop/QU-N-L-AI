# Independent API adapters — Phase 2

Đây là REST adapter do ORBIT triển khai độc lập, không sao chép hoặc phụ thuộc Claude Code. Phần mock vẫn dùng cho tests. Không khai báo model IDs/giá mặc định vì quyền/quota và giá tùy tài khoản/thời điểm.

| Provider      | Endpoint cố định                                                     | Structured output                                                                  | Usage                                |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| OpenAI        | api.openai.com/v1/chat/completions                                   | response_format=json_object + JSON schema trong system prompt; Zod xác minh        | prompt_tokens/completion_tokens      |
| Anthropic     | api.anthropic.com/v1/messages                                        | tool orbit_result có input_schema; forced tool_choice; không execute external tool | input_tokens/output_tokens           |
| Google Gemini | generativelanguage.googleapis.com/v1beta/models/{id}:generateContent | responseMimeType=application/json + schema prompt; Zod xác minh                    | prompt + candidates + thought tokens |
| xAI           | api.x.ai/v1/chat/completions                                         | JSON object mode + schema prompt; Zod xác minh                                     | prompt_tokens/completion_tokens      |

Chỉ models hỗ trợ giao thức trên mới dùng được. OpenAI dùng max_completion_tokens; Anthropic/xAI max_tokens; Gemini maxOutputTokens. Không triển khai streaming, tools bên ngoài, image/video generation, hosted agents hoặc reasoning-model-specific options. Gemini thought output không được coi là JSON trả về; reported thought tokens vẫn tính usage. Hãng có thể đổi API, entitlement và giá; mọi adapter phải qua probe/workflow thật trước khi nghiệm thu.

Transport Node dùng undici và proxy/CA môi trường, HTTPS verification giữ nguyên, redirects từ chối, response giới hạn 2 MB. Input cap dùng byte upper bound của prompt/schema và overhead; đây là kiểm soát bảo thủ, không tokenizer chính xác. Không hidden retries: 429/5xx/timeout trả mã chuẩn về engine có backoff/bounded retries. 401/403 và 404 không tự retry. Raw provider error/header không đưa vào API/log. Nếu response echo API key, adapter redact trước handoff. Credential chỉ lấy từ server environment, không có endpoint client tùy ý.

Provenance chứa kind/provider/requested model/returned model/request ID khi API có trả. HTTP_STUB luôn adapter mode MOCK/ID stub-*, không Connected. Official successful structured response mới tạo LIVE_API evidence. Probe giữ config hash + HMAC credential tag 15 phút, selected model, latency và usage; không lưu key. Adapter health đơn thuần chỉ DISCONNECTED/PROBE_REQUIRED. Capabilities khai báo analysis/review/planning; readiness xác minh đường structured inference, kết quả mỗi task vẫn validate schema/checksum.

Schema Analysis/Review/ProposedPlan cùng dùng giữa hãng, artifact hash truyền qua dependency. Review dùng provider khác analyst. Giá/token limits chụp tại claim; billed usage là input operator khai báo, rounding lên cents. Đây không phải invoice. Request đã gửi nhưng timeout/crash/5xx có thể bị tính tiền: local ledger ghi reservation bảo thủ, cần đối chiếu hãng sau này. Không exactly-once inference guarantee.

Tài liệu giao thức chính thức tham chiếu:

- https://platform.openai.com/docs/api-reference/chat/create
- https://platform.claude.com/docs/en/api/messages
- https://ai.google.dev/api/generate-content
- https://docs.x.ai/docs/api-reference

Đã đối chiếu protocol fields OpenAI/Anthropic qua type declarations trong repository SDK chính thức; không nhúng SDK/codebase đó vào ORBIT. Các HTTP protocol fixtures chỉ chứng minh build/parse/validation/error handling cục bộ. Cả bốn API keys hiện vắng mặt: chưa có proof LIVE về endpoint/model/account ở phiên này.

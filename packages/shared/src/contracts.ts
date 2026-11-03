import { z } from "zod";
export const Mode = z.enum(["MOCK", "LIVE"]);
export const GoalInput = z
  .object({
    goal: z.string().trim().min(10).max(5000),
    workspace_id: z.uuid(),
    seo_dataset_id: z.uuid().optional(),
    acceptance_criteria: z
      .array(z.string().trim().min(1).max(500))
      .max(10)
      .default([]),
    budget_cents: z.number().int().min(0).max(100000).default(0),
    mode: Mode.default("MOCK"),
    live_data_consent: z.boolean().default(false),
    planning_strategy: z
      .enum(["TEMPLATE", "AI_WITH_FALLBACK"])
      .default("TEMPLATE"),
    site: z
      .url()
      .refine((value) => {
        try {
          const u = new URL(value);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            u.pathname === "/" &&
            !u.search &&
            !u.hash
          );
        } catch {
          return false;
        }
      }, "Dùng địa chỉ gốc HTTPS, không kèm credential hoặc đường dẫn.")
      .default("https://example.org"),
    attachment_ids: z.array(z.uuid()).max(5).default([]),
    request_key: z.uuid(),
    scenario: z
      .enum(["normal", "fail-once", "invalid-output", "timeout"])
      .default("normal"),
  })
  .strict();
export type Goal = z.infer<typeof GoalInput>;
export const Recommendation = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    priority: z.enum(["P1", "P2", "P3"]),
    reason: z.string().min(1),
    evidence: z.string().min(1),
    acceptance: z.string().min(1),
  })
  .strict();
export const Analysis = z
  .object({
    summary: z.string().min(1),
    findings: z.array(Recommendation).min(1).max(20),
    limitations: z.array(z.string()).min(1),
    source_sha256: z.string().length(64),
  })
  .strict();
export const Review = z
  .object({
    summary: z.string().min(1),
    findings: z.array(Recommendation).min(1).max(20),
    limitations: z.array(z.string()).min(1),
    source_sha256: z.string().length(64),
    reviewed: z.literal(true),
    review_notes: z.array(z.string()).min(1),
  })
  .strict();
export const GscData = z
  .object({
    source: z.literal("MOCK"),
    site: z.url(),
    period: z.object({ start: z.string(), end: z.string() }),
    filters: z.object({
      search_type: z.literal("web"),
      device: z.literal("all"),
      country: z.literal("all"),
    }),
    rows: z
      .array(
        z.object({
          page: z.url(),
          query: z.string(),
          clicks: z.number().nonnegative(),
          impressions: z.number().nonnegative(),
          position: z.number().nonnegative(),
        }),
      )
      .min(1),
    notice: z.string(),
  })
  .strict();
export const ContextData = z
  .object({
    source: z.enum(["MOCK", "USER_INPUT"]),
    goal: z.string(),
    workspace: z.string(),
    attachments: z.array(z.string()),
    notice: z.string(),
  })
  .strict();
export const Board = z
  .object({
    summary: z.string(),
    items: z.array(Recommendation).min(1),
    limitations: z.array(z.string()),
    source_sha256: z.string().length(64),
  })
  .strict();
export const Approved = z
  .object({
    approved: z.literal(true),
    output_hash: z.string().length(64),
    actor: z.string(),
  })
  .strict();
export const Delivery = z
  .object({
    verified: z.literal(true),
    mode: Mode,
    report: z.string().min(1),
    board: Board,
    approved_by: z.string(),
  })
  .strict();
export const NodeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  title: z.string(),
  handler: z.string(),
  kind: z.enum(["tool", "model", "transform", "approval", "report"]),
  capability: z.string(),
  effect: z.enum(["read", "write"]).default("read"),
  depends_on: z.array(z.string()),
  acceptance: z.string(),
  priority: z.number().int().min(1).max(3).default(2),
  max_attempts: z.number().int().min(1).max(5).default(3),
  timeout_ms: z.number().int().min(100).max(120000).default(10000),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type Node = z.infer<typeof NodeSchema>;
export const GoalContract = z
  .object({
    version: z.literal(1),
    strategy: z.enum(["TEMPLATE", "AI"]),
    objective: z.string().min(10),
    workspace: z.string(),
    deliverables: z.array(z.string()).min(1),
    acceptance_criteria: z.array(z.string()).min(1),
    constraints: z.object({
      mode: Mode,
      read_only: z.literal(true),
      external_calls: z.boolean(),
      budget_cents: z.number().int().nonnegative(),
    }),
    notice: z.string(),
  })
  .strict();
export type GoalInterpretation = z.infer<typeof GoalContract>;
export type Plan = {
  interpretation: GoalInterpretation;
  version: 1;
  template: string;
  workspace: string;
  nodes: Node[];
  estimate: { mode: "MOCK" | "LIVE"; cost_cents: number; notice: string };
};
export class OrbitError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public billingUncertain = false,
  ) {
    super(code);
  }
}
export const safeMessage: Record<string, string> = {
  TIMEOUT: "Tác vụ quá thời gian cho phép.",
  PROVIDER_FAILURE: "Adapter trả lỗi; đang áp dụng giới hạn thử lại.",
  INVALID_OUTPUT: "Đầu ra không đúng schema.",
  BUDGET_EXCEEDED: "Ngân sách không đủ cho tác vụ tiếp theo.",
  FORBIDDEN_EFFECT: "MVP chỉ cho phép đọc dữ liệu và tạo báo cáo.",
  NO_PROVIDER: "Không có adapter phù hợp với capability và chính sách dữ liệu.",
  ARTIFACT_CORRUPT: "Không xác minh được checksum dữ liệu.",
  INTERRUPTED: "Worker bị gián đoạn, đang phục hồi checkpoint.",
  CANCELED: "Đã hủy lượt chạy.",
  LIVE_UNAVAILABLE: "Chưa có adapter LIVE được xác minh.",
  NOT_FOUND: "Không tìm thấy dữ liệu hoặc anh không có quyền truy cập.",
  CONFLICT: "Trạng thái đã thay đổi; tải lại trước khi tiếp tục.",
  UNAUTHORIZED: "Anh cần đăng nhập.",
  BAD_REQUEST: "Yêu cầu không hợp lệ.",
};

export const ModelProfile = z
  .object({
    input_usd_per_million: z.number().finite().nonnegative().max(10000),
    output_usd_per_million: z.number().finite().nonnegative().max(10000),
    max_input_tokens: z.number().int().min(1024).max(200000),
    max_output_tokens: z.number().int().min(128).max(8192),
    price_source: z.string().min(5).max(300),
    price_date: z.iso.date(),
  })
  .strict();
export type PricingProfile = z.infer<typeof ModelProfile>;
export const ProposedPlan = z
  .object({
    objective: z.string().min(10).max(5000),
    acceptance_criteria: z.array(z.string().min(1).max(500)).min(1).max(32),
    steps: z
      .array(
        z
          .object({
            key: z.enum(["analyze", "review", "board", "approve", "deliver"]),
            depends_on: z
              .array(
                z.enum([
                  "source",
                  "interpret",
                  "analyze",
                  "review",
                  "board",
                  "approve",
                ]),
              )
              .max(6),
            instruction: z.string().min(5).max(1500),
            effect: z.literal("read"),
          })
          .strict(),
      )
      .length(5),
  })
  .strict();
export const InterpretedPlan = z
  .object({
    strategy: z.enum(["AI", "TEMPLATE_FALLBACK"]),
    plan: ProposedPlan,
    fallback_reason: z.string().nullable(),
  })
  .strict();
export const ProbeOutput = z.object({ ok: z.literal(true) }).strict();
export type Evidence = {
  kind: "MOCK" | "HTTP_STUB" | "LIVE_API";
  provider: string;
  model: string;
  request_id?: string;
  actual_model?: string;
};
export const phase2Messages: Record<string, string> = {
  MISSING_CREDENTIAL: "Thiếu API key phía server.",
  LIVE_NOT_READY:
    "Cần ít nhất hai provider/model đã probe API thật và cho phép xử lý dữ liệu bên ngoài.",
  EXTERNAL_POLICY: "Chưa cấp phép gửi dữ liệu đến AI bên ngoài.",
  PRICING_REQUIRED: "Thiếu cấu hình giá/token limits hợp lệ.",
  UNVERIFIED_MODEL: "Model chưa có probe API thật còn hiệu lực.",
  AUTH_FAILED: "API từ chối credential.",
  QUOTA_EXCEEDED:
    "Đã đạt giới hạn 50 workflow chưa kết thúc. Hoàn tất hoặc hủy bớt trước khi tạo mới.",
  RATE_LIMIT: "Nhà cung cấp giới hạn tốc độ.",
  API_RESPONSE_INVALID: "Phản hồi API không hợp lệ.",
  CONTEXT_LIMIT: "Input vượt giới hạn token đã cấu hình.",
  LIVE_SOURCE_UNAVAILABLE:
    "SEO LIVE cần dataset đã lưu trong SEO Workspace; nguồn fixture không được coi là dữ liệu thật.",
  UNTRUSTED_EXECUTION: "Không có bằng chứng thực thi API thật.",
};
Object.assign(safeMessage, phase2Messages);

safeMessage.PROBE_BUSY =
  "Đang có probe hoặc vừa kiểm tra kết nối. Vui lòng thử lại sau.";

Object.assign(safeMessage, {
  GSC_ENCRYPTION_REQUIRED: "Thiếu encryption key 32 bytes phía server.",
  GSC_CONFIG_REQUIRED: "Chưa cấu hình Google OAuth client phía server.",
  GSC_REAUTH_REQUIRED: "Quyền Google đã hết hiệu lực; cần kết nối lại.",
  GSC_FORBIDDEN: "Không có quyền đọc property GSC này.",
  GSC_RATE_LIMIT: "GSC giới hạn tốc độ; worker sẽ thử lại có backoff.",
  GSC_TIMEOUT: "GSC quá thời gian; checkpoint được giữ để thử lại.",
  GSC_UNAUTHORIZED: "Google từ chối token.",
  GSC_RESPONSE_INVALID: "Phản hồi GSC không hợp lệ.",
  GSC_INVALID_DATA: "Dataset không hợp lệ, trùng dòng hoặc ngoài property.",
  GSC_EMPTY_DATASET: "Dataset không có dòng để phân tích.",
  GSC_TOKEN_DECRYPT_FAILED:
    "Không giải mã được token; kiểm tra encryption key.",
  GSC_SOURCE_MISMATCH: "Checksum nguồn hoặc evidence không khớp.",
  SEO_TEMPLATE_REQUIRED:
    "Dataset SEO dùng template có bước validation bắt buộc.",
  GSC_DISCONNECTED: "Chưa kết nối GSC.",
  GSC_REVOKE_PENDING:
    "Đang chờ thu hồi quyền; kết nối không được phép đọc dữ liệu.",
});
Object.assign(safeMessage, {
  GSC_OAUTH_STATE:
    "Phiên OAuth không hợp lệ, hết hạn hoặc đã dùng; hãy bắt đầu kết nối lại.",
  GSC_SCOPE_REJECTED:
    "Token trả về có scope ngoài webmasters.readonly; kết nối bị từ chối.",
  GSC_REFRESH_TOKEN_REQUIRED:
    "Google chưa cấp refresh token; cần consent offline mới.",
  GSC_UNAVAILABLE: "Dịch vụ Google tạm lỗi; worker sẽ thử lại có giới hạn.",
  GSC_REQUEST_REJECTED: "Google từ chối yêu cầu đọc dữ liệu.",
});

Object.assign(safeMessage, {
  FORBIDDEN: "Tài khoản không có quyền thực hiện thao tác này.",
  PASSWORD_POLICY: "Mật khẩu cần 16–512 ký tự.",
  AUTH_EXPIRED: "Phiên đăng nhập đã hết hạn.",
  SERVICE_NOT_READY: "Dịch vụ chưa sẵn sàng.",
});

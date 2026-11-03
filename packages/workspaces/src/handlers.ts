import { seoDatasetHandlers } from "./seo-handlers";
import {
  templateAIPlan,
  validateAIPlan,
  allowedPlanningSteps,
} from "./ai-planning";
import { getWorkspace, workspaceModules } from "./registry";
import { z } from "zod";
import {
  Analysis,
  Review,
  GscData,
  ContextData,
  Board,
  Approved,
  Delivery,
  OrbitError,
  InterpretedPlan,
} from "@orbit/shared/contracts";
import { digest, jsonBytes } from "@orbit/storage/store";
import { getIntegration, type Handler } from "@orbit/core/registry";
const taskInput = z.object({
  goal: z.string(),
  site: z.url(),
  scenario: z.string(),
  workspace: z.string(),
  attachment_ids: z.array(z.string()),
});
const sourceSchema = z.union([GscData, ContextData]);
export const workspaceHandlers: Record<string, Handler> = {
  "report.interpret": {
    input: taskInput,
    output: InterpretedPlan,
    safeFallback: true,
    invokeTimeoutMs: 30000,
    async execute(ctx) {
      const contract = ctx.input.goal_contract as {
        acceptance_criteria?: string[];
      };
      const fallback = templateAIPlan(
        String(ctx.input.goal),
        contract?.acceptance_criteria ?? [],
      );
      try {
        const result = await ctx.invoke({
          objective: ctx.input.goal,
          planning_fixture: fallback,
          allowed_steps: allowedPlanningSteps,
          constraints: {
            read_only: true,
            external_effects: false,
            mandatory_human_approval: true,
          },
          instruction:
            "Return the exact objective and five allowed steps. Keep dependencies exactly as supplied; no tools, code, endpoints or secret access.",
        });
        return {
          strategy: "AI",
          plan: validateAIPlan(
            result.output,
            String(ctx.input.goal),
            fallback.acceptance_criteria,
          ),
          fallback_reason: null,
        };
      } catch (error) {
        if (
          error instanceof OrbitError &&
          ["CLI_LIMIT_REACHED", "CLI_NOT_SIGNED_IN"].includes(error.code)
        )
          throw error;
        return {
          strategy: "TEMPLATE_FALLBACK",
          plan: fallback,
          fallback_reason:
            error instanceof OrbitError ? error.code : "INVALID_AI_PLAN",
        };
      }
    },
  },
  "seo.source": {
    input: taskInput,
    output: GscData,
    async execute(ctx) {
      return getIntegration("mock-gsc").execute(ctx.input, ctx.signal);
    },
  },
  "general.source": {
    input: taskInput,
    output: ContextData,
    async execute(ctx) {
      return {
        source: ctx.input.mode === "LIVE" ? "USER_INPUT" : "MOCK",
        goal: ctx.input.goal,
        workspace: ctx.input.workspace,
        attachments: ctx.input.attachment_ids,
        notice:
          ctx.input.mode === "LIVE"
            ? "Nguồn yêu cầu do người dùng cung cấp; chưa đọc dữ liệu từ integration bên ngoài."
            : "Template báo cáo MOCK; chưa xử lý video hoặc thực thi code.",
      };
    },
  },
  "report.analyze": {
    input: taskInput,
    output: Analysis,
    async execute(ctx) {
      sourceSchema.parse(ctx.inputs.source);
      const result = await ctx.invoke({
        source: ctx.inputs.source,
        ...(ctx.input.mode !== "LIVE"
          ? {
              fixture: getWorkspace(String(ctx.input.workspace)).fixture({
                goal: String(ctx.input.goal),
                site: String(ctx.input.site),
                source_sha256: ctx.hashes.source,
              }),
            }
          : {}),
        planning: ctx.inputs.interpret,
        source_sha256: ctx.hashes.source,
      });
      const output = Analysis.parse(result.output);
      if (output.source_sha256 !== ctx.hashes.source)
        throw new OrbitError("INVALID_OUTPUT");
      return output;
    },
  },
  "report.review": {
    input: taskInput,
    output: Review,
    async execute(ctx) {
      const a = Analysis.parse(ctx.inputs.analyze);
      sourceSchema.parse(ctx.inputs.source);
      if (a.source_sha256 !== ctx.hashes.source)
        throw new OrbitError("INVALID_OUTPUT");
      const output = Review.parse(
        (
          await ctx.invoke({
            source: ctx.inputs.source,
            analysis: a,
            planning: ctx.inputs.interpret,
            source_sha256: ctx.hashes.source,
          })
        ).output,
      );
      if (output.source_sha256 !== ctx.hashes.source)
        throw new OrbitError("INVALID_OUTPUT");
      return output;
    },
  },
  "report.board": {
    input: taskInput,
    output: Board,
    async execute(ctx) {
      const r = Review.parse(ctx.inputs.review);
      return {
        summary: r.summary,
        items: r.findings,
        limitations: r.limitations,
        source_sha256: r.source_sha256,
      };
    },
  },
  "report.approval": {
    input: taskInput,
    output: Approved,
    async execute() {
      throw new OrbitError("BAD_REQUEST");
    },
  },
  "report.deliver": {
    input: taskInput,
    output: Delivery,
    async execute(ctx) {
      const board = Board.parse(ctx.inputs.board),
        approval = Approved.parse(ctx.inputs.approve);
      if (digest(jsonBytes(board)) !== approval.output_hash)
        throw new OrbitError("INVALID_OUTPUT");
      const report = [
        ctx.input.mode === "LIVE"
          ? "# ORBIT — Báo cáo từ API AI thật"
          : "# ORBIT — Báo cáo MOCK",
        board.summary,
        ...board.items.map(
          (i) =>
            `## ${i.id}: ${i.title}\n- URL: ${i.url}\n- Evidence: ${i.evidence}\n- Acceptance: ${i.acceptance}`,
        ),
        "## Giới hạn",
        ...board.limitations,
        "Không thực hiện thao tác ghi lên dịch vụ bên ngoài.",
      ].join("\n\n");
      return {
        verified: true,
        mode: ctx.input.mode === "LIVE" ? "LIVE" : "MOCK",
        report,
        board,
        approved_by: approval.actor,
      };
    },
  },
};

for (const module of workspaceModules) {
  if (module.kind !== "seo")
    workspaceHandlers[module.sourceHandler] =
      workspaceHandlers["general.source"];
}

Object.assign(workspaceHandlers, seoDatasetHandlers);

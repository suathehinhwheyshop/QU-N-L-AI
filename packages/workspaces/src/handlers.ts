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
        source: "MOCK",
        goal: ctx.input.goal,
        workspace: ctx.input.workspace,
        attachments: ctx.input.attachment_ids,
        notice:
          "Template báo cáo tổng quát MOCK; chưa xử lý video hoặc thực thi code.",
      };
    },
  },
  "report.analyze": {
    input: taskInput,
    output: Analysis,
    async execute(ctx) {
      sourceSchema.parse(ctx.inputs.source);
      return (
        await ctx.invoke({
          source: ctx.inputs.source,
          fixture: getWorkspace(String(ctx.input.workspace)).fixture({
            goal: String(ctx.input.goal),
            site: String(ctx.input.site),
            source_sha256: ctx.hashes.source,
          }),
          source_sha256: ctx.hashes.source,
        })
      ).output;
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
      return (
        await ctx.invoke({
          source: ctx.inputs.source,
          analysis: a,
          source_sha256: ctx.hashes.source,
        })
      ).output;
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
        "# ORBIT — Báo cáo MOCK",
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
        mode: "MOCK",
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

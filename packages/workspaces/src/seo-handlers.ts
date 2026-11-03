import { z } from "zod";
import {
  SeoSource,
  SeoAdvice,
  SeoReview,
  SeoBoard,
  SeoDelivery,
  Hash,
} from "@orbit/shared/seo";
import { Approved, OrbitError } from "@orbit/shared/contracts";
import { digest, jsonBytes } from "@orbit/storage/store";
import { loadDataset, collectDataset } from "@orbit/integrations/seo-data";
import {
  computeFacts,
  adviceFixture,
  validateAdvice,
  synthesize,
  boardCsv,
} from "./seo-insights";
import type { Handler } from "@orbit/core/registry";
const input = z.object({ dataset_id: z.uuid() });
export const seoDatasetHandlers: Record<string, Handler> = {
  "gsc.collect": {
    input: z.object({ job_id: z.uuid() }),
    output: z.object({ dataset_id: z.uuid(), sha256: Hash, kind: z.string() }),
    execute: (ctx) => collectDataset(ctx),
  },
  "seo.dataset.source": {
    input,
    output: SeoSource,
    async execute(ctx) {
      const { row, data } = await loadDataset(
        ctx.execution.ownerId,
        String(ctx.input.dataset_id),
      );
      const facts = computeFacts(data, row.sha256);
      return {
        dataset_id: row.id,
        dataset_sha256: row.sha256,
        provenance: data.provenance,
        spec: data.spec,
        facts,
        facts_sha256: digest(jsonBytes(facts)),
      };
    },
  },
  "seo.dataset.analyze": {
    input,
    output: SeoAdvice,
    async execute(ctx) {
      const source = SeoSource.parse(ctx.inputs.source);
      const result = await ctx.invoke({
        source_sha256: ctx.hashes.source,
        facts_sha256: source.facts_sha256,
        facts: source.facts,
        instruction:
          "Choose only supplied fact IDs and eligible reasons/actions. Never invent numbers, URLs, source claims or unsupported causes. Output only the schema.",
        structured_fixture: adviceFixture(
          source.facts,
          ctx.hashes.source,
          source.facts_sha256,
        ),
      });
      return validateAdvice(
        result.output,
        source.facts,
        ctx.hashes.source,
        source.facts_sha256,
      );
    },
  },
  "seo.dataset.review": {
    input,
    output: SeoReview,
    async execute(ctx) {
      const s = SeoSource.parse(ctx.inputs.source);
      validateAdvice(
        ctx.inputs.analyze,
        s.facts,
        ctx.hashes.source,
        s.facts_sha256,
      );
      const result = await ctx.invoke({
        source_sha256: ctx.hashes.source,
        facts_sha256: s.facts_sha256,
        facts: s.facts,
        analysis: ctx.inputs.analyze,
        instruction:
          "Independently verify evidence IDs and eligible reasons. Return reviewed true and only supported actions; never create measurements.",
        structured_fixture: { ...ctx.inputs.analyze, reviewed: true },
      });
      return validateAdvice(
        result.output,
        s.facts,
        ctx.hashes.source,
        s.facts_sha256,
        true,
      );
    },
  },
  "seo.dataset.validate": {
    input,
    output: SeoReview,
    async execute(ctx) {
      const s = SeoSource.parse(ctx.inputs.source);
      if (digest(jsonBytes(s.facts)) !== s.facts_sha256)
        throw new OrbitError("GSC_SOURCE_MISMATCH");
      const fresh = await loadDataset(ctx.execution.ownerId, s.dataset_id);
      if (
        fresh.row.sha256 !== s.dataset_sha256 ||
        digest(jsonBytes(computeFacts(fresh.data, fresh.row.sha256))) !==
          s.facts_sha256
      )
        throw new OrbitError("GSC_SOURCE_MISMATCH");
      validateAdvice(
        ctx.inputs.analyze,
        s.facts,
        ctx.hashes.source,
        s.facts_sha256,
      );
      return validateAdvice(
        ctx.inputs.review,
        s.facts,
        ctx.hashes.source,
        s.facts_sha256,
        true,
      );
    },
  },
  "seo.dataset.board": {
    input,
    output: SeoBoard,
    async execute(ctx) {
      const s = SeoSource.parse(ctx.inputs.source);
      return synthesize(s, ctx.hashes.source, ctx.inputs.validate);
    },
  },
  "seo.dataset.deliver": {
    input,
    output: SeoDelivery,
    async execute(ctx) {
      const board = SeoBoard.parse(ctx.inputs.board),
        approval = Approved.parse(ctx.inputs.approve);
      if (digest(jsonBytes(board)) !== approval.output_hash)
        throw new OrbitError("INVALID_OUTPUT");
      const report = [
        "# ORBIT — SEO report",
        `AI mode: ${ctx.input.mode}; GSC source: ${board.source_kind}`,
        `Dataset checksum: ${board.dataset_sha256}`,
        `Facts checksum: ${board.facts_sha256}`,
        JSON.stringify({
          current: board.metrics,
          previous: board.previous_metrics,
        }),
        ...board.items.flatMap((i) => [
          `## ${i.id} — ${i.title}`,
          i.url,
          i.reason,
          i.evidence,
          i.acceptance,
        ]),
        "## Cảnh báo và giới hạn",
        ...board.warnings,
        "Không thay đổi hoặc xuất bản website.",
      ].join("\n\n");
      return {
        verified: true,
        mode: ctx.input.mode === "LIVE" ? "LIVE" : "MOCK",
        report,
        board,
        approved_by: approval.actor,
      };
    },
    renderArtifacts(output) {
      const d = SeoDelivery.parse(output);
      return [
        {
          name: "seo-report.md",
          kind: "report_md",
          mediaType: "text/markdown",
          bytes: Buffer.from(d.report),
        },
        {
          name: "seo-tasks.csv",
          kind: "report_csv",
          mediaType: "text/csv",
          bytes: Buffer.from(boardCsv(d.board)),
        },
        {
          name: "seo-report.json",
          kind: "report_json",
          mediaType: "application/json",
          bytes: jsonBytes(d),
        },
      ];
    },
  },
};

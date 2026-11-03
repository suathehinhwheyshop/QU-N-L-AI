import { z } from "zod";
import { OrbitError } from "./contracts";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Property = z
  .string()
  .max(2048)
  .refine((v) => {
    if (v.startsWith("sc-domain:"))
      return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
        v.slice(10),
      );
    try {
      const u = new URL(v);
      return (
        ["https:", "http:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    } catch {
      return false;
    }
  }, "Property phải là URL-prefix hoặc sc-domain hợp lệ.");
export const Period = z
  .object({ start: z.iso.date(), end: z.iso.date() })
  .strict()
  .refine(
    (p) =>
      p.start <= p.end &&
      Number.isFinite(Date.parse(p.start)) &&
      Number.isFinite(Date.parse(p.end)) &&
      (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 366,
    "Khoảng ngày không hợp lệ hoặc quá 366 ngày.",
  );
export const SearchRequest = z
  .object({
    property: Property,
    current: Period,
    previous: Period.optional(),
    search_type: z.enum(["web", "image", "video", "news"]).default("web"),
    country: z
      .string()
      .regex(/^(all|[a-z]{3})$/)
      .default("all"),
    device: z.enum(["all", "desktop", "mobile", "tablet"]).default("all"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.previous) {
      if (
        v.previous.end >= v.current.start ||
        Date.parse(v.current.end) - Date.parse(v.current.start) !==
          Date.parse(v.previous.end) - Date.parse(v.previous.start)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Hai kỳ phải cùng độ dài, không chồng lấn; kỳ trước đứng trước kỳ hiện tại.",
        });
    }
  });
export type SearchSpec = z.infer<typeof SearchRequest>;
export const SearchRow = z
  .object({
    page: z.url().max(4096),
    query: z.string().max(2048),
    clicks: z.number().int().nonnegative(),
    impressions: z.number().int().nonnegative(),
    position: z.number().finite().nonnegative().max(100000),
  })
  .strict()
  .refine((r) => r.clicks <= r.impressions, "Clicks vượt impressions.");
export type Row = z.infer<typeof SearchRow>;
export const Dataset = z
  .object({
    version: z.literal(1),
    spec: SearchRequest,
    current: z.array(SearchRow).max(50000),
    previous: z.array(SearchRow).max(50000),
    provenance: z
      .object({
        kind: z.enum(["GSC_API", "HTTP_STUB", "IMPORT"]),
        captured_at: z.iso.datetime(),
        source_hashes: z.array(Hash).min(1),
        warnings: z.array(z.string()).min(1),
        permission: z.literal("read-only"),
        timezone: z.literal("America/Los_Angeles"),
      })
      .strict(),
  })
  .strict();
export type SeoDataset = z.infer<typeof Dataset>;
export const Metric = z
  .object({
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  })
  .strict();
export const Fact = z
  .object({
    id: z.string(),
    page: z.url(),
    query: z.string(),
    current_present: z.boolean(),
    previous_present: z.boolean(),
    current: Metric,
    previous: Metric.nullable(),
    click_delta: z.number().nullable(),
    click_change_pct: z.number().nullable(),
    eligible: z.array(
      z.enum(["LOW_CTR", "DECLINING_CLICKS", "NEAR_TOP", "MONITOR"]),
    ),
  })
  .strict();
export type SeoFact = z.infer<typeof Fact>;
export const Facts = z
  .object({
    dataset_sha256: Hash,
    totals: Metric,
    previous_totals: Metric.nullable(),
    facts: z.array(Fact).min(1).max(20),
    warnings: z.array(z.string()),
  })
  .strict();
export type FactBundle = z.infer<typeof Facts>;
export const SeoAdvice = z
  .object({
    source_sha256: Hash,
    facts_sha256: Hash,
    items: z
      .array(
        z
          .object({
            fact_id: z.string().min(1).max(80),
            action: z.enum([
              "REVIEW_SNIPPET",
              "REVIEW_CONTENT",
              "INVESTIGATE_DECLINE",
              "MONITOR",
            ]),
            reason: z.enum([
              "LOW_CTR",
              "DECLINING_CLICKS",
              "NEAR_TOP",
              "MONITOR",
            ]),
            priority: z.enum(["P1", "P2", "P3"]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const SeoReview = SeoAdvice.extend({
  reviewed: z.literal(true),
}).strict();
export const SeoSource = z
  .object({
    dataset_id: z.uuid(),
    dataset_sha256: Hash,
    provenance: Dataset.shape.provenance,
    spec: SearchRequest,
    facts: Facts,
    facts_sha256: Hash,
  })
  .strict();
export const SeoBoard = z
  .object({
    summary: z.string(),
    source_sha256: Hash,
    facts_sha256: Hash,
    dataset_sha256: Hash,
    source_kind: Dataset.shape.provenance.shape.kind,
    metrics: Metric,
    previous_metrics: Metric.nullable(),
    warnings: z.array(z.string()),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            fact_id: z.string(),
            title: z.string(),
            url: z.url(),
            priority: z.enum(["P1", "P2", "P3"]),
            reason: z.string(),
            evidence: z.string(),
            acceptance: z.string(),
            metrics: Metric,
            previous_metrics: Metric.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const SeoDelivery = z
  .object({
    verified: z.literal(true),
    mode: z.enum(["MOCK", "LIVE"]),
    report: z.string(),
    board: SeoBoard,
    approved_by: z.string(),
  })
  .strict();
export function pageBelongs(property: string, page: string) {
  const u = new URL(page);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    return false;
  if (property.startsWith("sc-domain:")) {
    const host = property.slice(10).toLowerCase();
    return u.hostname === host || u.hostname.endsWith("." + host);
  }
  const prefix = new URL(property);
  return prefix.origin === u.origin && u.pathname.startsWith(prefix.pathname);
}
export function assertRows(spec: SearchSpec, current: Row[], previous: Row[]) {
  if (!spec.previous && previous.length)
    throw new OrbitError("GSC_INVALID_DATA");
  for (const rows of [current, previous]) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify([row.page, row.query]);
      if (seen.has(key) || !pageBelongs(spec.property, row.page))
        throw new OrbitError("GSC_INVALID_DATA");
      seen.add(key);
    }
  }
}

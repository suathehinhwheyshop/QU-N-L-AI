import { z } from "zod";
import { GscOAuth } from "./gsc-oauth";
import { Property, SearchRow, type SearchSpec } from "@orbit/shared/seo";
import { OrbitError } from "@orbit/shared/contracts";
export class GscClient {
  constructor(
    readonly oauth = new GscOAuth(),
    readonly pageSize = 5000,
    readonly maxRows = 50000,
  ) {}
  async discover(owner: string, signal: AbortSignal) {
    const raw = await this.oauth.authorized(owner, "/sites", undefined, signal);
    const properties = z
      .object({
        siteEntry: z
          .array(
            z.object({
              siteUrl: Property,
              permissionLevel: z.enum([
                "siteOwner",
                "siteFullUser",
                "siteRestrictedUser",
                "siteUnverifiedUser",
              ]),
            }),
          )
          .default([]),
      })
      .parse(raw)
      .siteEntry.filter((p) => p.permissionLevel !== "siteUnverifiedUser");
    const pool = (await import("@orbit/database/client")).pool;
    await pool.query(
      "UPDATE gsc_accounts SET properties=$2,status=$3,verified_at=now(),error_code=NULL,updated_at=now() WHERE owner_id=$1 AND status IN ('AUTHORIZED','CONNECTED','HTTP_STUB') AND kind=$4",
      [
        owner,
        JSON.stringify(properties),
        this.oauth.transport.kind === "GSC_API" ? "CONNECTED" : "HTTP_STUB",
        this.oauth.transport.kind,
      ],
    );
    return { kind: this.oauth.transport.kind, properties };
  }
  async page(
    owner: string,
    spec: SearchSpec,
    period: "current" | "previous",
    start: number,
    signal: AbortSignal,
  ) {
    const range = spec[period];
    if (!range) throw new OrbitError("GSC_INVALID_DATA");
    const filters = [];
    if (spec.country !== "all")
      filters.push({
        dimension: "country",
        operator: "equals",
        expression: spec.country,
      });
    if (spec.device !== "all")
      filters.push({
        dimension: "device",
        operator: "equals",
        expression: spec.device,
      });
    const raw = await this.oauth.authorized(
      owner,
      "/sites/" + encodeURIComponent(spec.property) + "/searchAnalytics/query",
      {
        startDate: range.start,
        endDate: range.end,
        type: spec.search_type,
        dataState: "final",
        dimensions: ["page", "query"],
        rowLimit: this.pageSize,
        startRow: start,
        ...(filters.length
          ? { dimensionFilterGroups: [{ groupType: "and", filters }] }
          : {}),
      },
      signal,
    );
    const parsed = z
      .object({
        rows: z
          .array(
            z.object({
              keys: z.tuple([z.string(), z.string()]),
              clicks: z.number(),
              impressions: z.number(),
              position: z.number(),
              ctr: z.number().optional(),
            }),
          )
          .max(this.pageSize)
          .default([]),
      })
      .parse(raw);
    return parsed.rows.map((r) =>
      SearchRow.parse({
        page: r.keys[0],
        query: r.keys[1],
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position,
      }),
    );
  }
}

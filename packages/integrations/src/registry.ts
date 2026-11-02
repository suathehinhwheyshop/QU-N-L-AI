import { z } from "zod";
import { GscData, OrbitError } from "@orbit/shared/contracts";
import type { IntegrationAdapter } from "@orbit/core/registry";

const inputSchema = z.object({ site: z.url() });
const gscFixture: IntegrationAdapter = {
  id: "mock-gsc",
  name: "GSC · Fixture Connector",
  mode: "MOCK",
  scopes: ["fixture.read"],
  input: inputSchema,
  output: GscData,
  async health() {
    return { status: "MOCK", code: "MOCK_CONNECTOR_OK" };
  },
  async execute(raw, signal) {
    if (signal.aborted) throw new OrbitError("TIMEOUT", true);
    const input = inputSchema.parse(raw);
    return GscData.parse({
      source: "MOCK",
      site: input.site,
      period: { start: "2026-10-01", end: "2026-10-31" },
      filters: { search_type: "web", country: "all", device: "all" },
      rows: [
        {
          page: input.site + "/whey-isolate",
          query: "whey isolate",
          clicks: 320,
          impressions: 18200,
          position: 8.2,
        },
      ],
      notice: "Fixture để kiểm thử connector; chưa đọc GSC thật.",
    });
  },
};
export const integrations: IntegrationAdapter[] = [gscFixture];

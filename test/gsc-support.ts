import { createServer } from "node:http";
import { once } from "node:events";
import type { GscTransport } from "@orbit/integrations/gsc-http";
export const testSpec = {
  property: "sc-domain:wheyshop.vn",
  current: { start: "2026-10-01", end: "2026-10-28" },
  previous: { start: "2026-09-03", end: "2026-09-30" },
  search_type: "web" as const,
  country: "all",
  device: "all" as const,
};
export const currentRows = [
  {
    page: "https://wheyshop.vn/whey",
    query: "whey",
    clicks: 20,
    impressions: 1000,
    position: 8,
  },
  {
    page: "https://wheyshop.vn/creatine",
    query: "creatine",
    clicks: 30,
    impressions: 500,
    position: 3,
  },
  {
    page: "https://wheyshop.vn/bcaa",
    query: "bcaa",
    clicks: 5,
    impressions: 500,
    position: 12,
  },
];
export const previousRows = [
  { ...currentRows[0], clicks: 40, impressions: 800, position: 6 },
  { ...currentRows[1], clicks: 20, impressions: 400, position: 4 },
];
export async function gscStub() {
  const requests: {
    path: string;
    body: Record<string, unknown>;
    authorization?: string;
  }[] = [];
  const state = {
    tokenStatus: 200,
    apiStatus: 200,
    failPageAt: -1,
    delay: 0,
    denyAccessOnce: false,
    refreshes: 0,
    revoked: false,
    revokeStatus: 200,
  };
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const b of req) text += b;
    let body: Record<string, unknown> = {};
    if (text)
      body = req.headers["content-type"]?.includes("json")
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
    requests.push({
      path: req.url!,
      body,
      authorization: req.headers.authorization,
    });
    res.setHeader("content-type", "application/json");
    if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
    if (req.url === "/token") {
      if (state.tokenStatus !== 200) {
        res.writeHead(state.tokenStatus);
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      if (body.grant_type === "refresh_token") state.refreshes++;
      res.end(
        JSON.stringify({
          access_token: "test-access-" + state.refreshes,
          refresh_token: "test-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        }),
      );
      return;
    }
    if (req.url === "/revoke") {
      if (state.revokeStatus !== 200) {
        res.writeHead(state.revokeStatus);
        res.end("{}");
        return;
      }
      state.revoked = true;
      res.end("{}");
      return;
    }
    if (state.denyAccessOnce) {
      state.denyAccessOnce = false;
      res.writeHead(401);
      res.end("{}");
      return;
    }
    const status =
      state.failPageAt >= 0 && body.startRow === state.failPageAt
        ? 429
        : state.apiStatus;
    if (status !== 200) {
      res.writeHead(status, { "retry-after": "1" });
      res.end(
        JSON.stringify({
          error: {
            errors: [
              {
                reason:
                  status === 403
                    ? "insufficientPermissions"
                    : "rateLimitExceeded",
              },
            ],
          },
        }),
      );
      return;
    }
    if (req.url === "/api/sites") {
      res.end(
        JSON.stringify({
          siteEntry: [
            { siteUrl: testSpec.property, permissionLevel: "siteOwner" },
          ],
        }),
      );
      return;
    }
    const rows =
      body.startDate === testSpec.previous.start ? previousRows : currentRows;
    const start = Number(body.startRow ?? 0);
    const count = Number(body.rowLimit ?? 5000);
    res.end(
      JSON.stringify({
        rows: rows.slice(start, start + count).map((r) => ({
          keys: [r.page, r.query],
          clicks: r.clicks,
          impressions: r.impressions,
          position: r.position,
          ctr: r.clicks / r.impressions,
        })),
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const transport: GscTransport = {
    kind: "HTTP_STUB",
    api: base + "/api",
    token: base + "/token",
    revoke: base + "/revoke",
    authorize: base + "/authorize",
    fetch: (u, i) => fetch(u, i),
  };
  return {
    transport,
    state,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

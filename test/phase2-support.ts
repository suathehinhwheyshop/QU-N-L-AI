import { adviceFixture } from "@orbit/workspaces/seo-insights";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { templateAIPlan } from "@orbit/workspaces/ai-planning";
export const stubProfile = {
  input_usd_per_million: 1,
  output_usd_per_million: 2,
  max_input_tokens: 32768,
  max_output_tokens: 2048,
  price_source: "HTTP_STUB fixture pricing; not vendor prices",
  price_date: "2026-11-02",
};
export async function stubApi() {
  const requests: {
    path: string;
    headers: IncomingHttpHeaders;
    body: Record<string, unknown>;
  }[] = [];
  const behavior = {
    status: 200,
    invalidJson: false,
    invalidPlan: false,
    delay: 0,
    echoKey: false,
    wrongReviewHash: false,
  };
  const server = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    requests.push({ path: req.url!, headers: req.headers, body });
    if (behavior.delay) await new Promise((r) => setTimeout(r, behavior.delay));
    if (behavior.status !== 200) {
      res.writeHead(behavior.status);
      res.end(JSON.stringify({ error: "stub error; no real API" }));
      return;
    }
    const content =
      body.contents?.[0]?.parts?.[0]?.text ??
      body.messages?.find((m: { role: string }) => m.role === "user")?.content;
    const packet = JSON.parse(content),
      input = packet.input;
    let output: unknown;
    if (packet.capability === "seo_analysis")
      output = adviceFixture(
        input.facts,
        input.source_sha256,
        input.facts_sha256,
      );
    else if (packet.capability === "seo_review")
      output = { ...input.analysis, reviewed: true };
    else if (packet.capability === "planning") {
      const plan = templateAIPlan(
        String(input.objective),
        input.planning_fixture?.acceptance_criteria ?? ["Fixture acceptance"],
      );
      if (behavior.invalidPlan)
        (plan.steps[0] as { effect: string }).effect = "write";
      output = plan;
    } else if (packet.capability === "review")
      output = {
        ...input.analysis,
        ...(behavior.wrongReviewHash ? { source_sha256: "0".repeat(64) } : {}),
        reviewed: true,
        review_notes: ["[HTTP_STUB] Independent review fixture received."],
      };
    else if (packet.capability === "probe") output = { ok: true };
    else
      output = {
        summary: behavior.echoKey
          ? "fixture-api-key"
          : "[HTTP_STUB] Analysis of supplied input",
        findings: [
          {
            id: "STUB-01",
            title: "Review input evidence",
            url: "https://example.org",
            priority: "P1",
            reason: "Protocol fixture only",
            evidence: "Source " + input.source_sha256,
            acceptance: "Human approval and schema validation",
          },
        ],
        limitations: ["HTTP stub; not live AI."],
        source_sha256: input.source_sha256,
      };
    if (behavior.invalidJson) output = "not-json";
    const encoded =
      typeof output === "string" ? output : JSON.stringify(output);
    res.setHeader("content-type", "application/json");
    res.setHeader("x-request-id", "stub-request");
    if (req.url?.startsWith("/anthropic/"))
      res.end(
        JSON.stringify({
          id: "stub-anthropic",
          model: "stub-model",
          content: [
            {
              type: "tool_use",
              name: "orbit_result",
              input: behavior.invalidJson ? "not-json" : output,
            },
          ],
          usage: { input_tokens: 20, output_tokens: 40 },
        }),
      );
    else if (req.url?.startsWith("/google/"))
      res.end(
        JSON.stringify({
          modelVersion: "stub-model",
          responseId: "stub-google",
          candidates: [{ content: { parts: [{ text: encoded }] } }],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 0,
          },
        }),
      );
    else
      res.end(
        JSON.stringify({
          id: "stub-completion",
          model: "stub-model",
          choices: [{ message: { content: encoded } }],
          usage: { prompt_tokens: 20, completion_tokens: 40 },
        }),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    url: "http://127.0.0.1:" + port,
    requests,
    behavior,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

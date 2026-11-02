import { createMockAdapter, type VendorDefinition } from "./mock";
export const anthropic: VendorDefinition = {
  id: "anthropic",
  name: "Claude / Anthropic",
  mockId: "mock-anthropic",
  model: "mock-anthropic/structured-v1",
  capabilities: ["analysis", "review", "planning"],
  latencyMs: 40,
};
export const createAnthropicMock = () => createMockAdapter(anthropic);

import type { Wire } from "./transport";
import { jsonOutput, tokenCount, safeId, ApiFailure } from "./transport";
export const anthropicWire: Wire = {
  id: "anthropic",
  name: "Anthropic",
  endpoint: "https://api.anthropic.com",
  keyName: "ORBIT_ANTHROPIC_API_KEY",
  build: (model, system, prompt, schema, maxTokens) => ({
    path: "/v1/messages",
    headers: { "anthropic-version": "2023-06-01" },
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "orbit_result",
          description:
            "Return the required structured result; no external tool is executed.",
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: "orbit_result" },
    },
  }),
  parse(raw, headers) {
    const b = raw as {
      content?: { type: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
      id?: string;
    };
    const block = b.content?.find(
      (c) => c.type === "tool_use" && c.name === "orbit_result",
    );
    if (!block) throw new ApiFailure("API_RESPONSE_INVALID", false, true);
    return {
      output: jsonOutput(block.input),
      inputTokens: tokenCount(b.usage?.input_tokens),
      outputTokens: tokenCount(b.usage?.output_tokens),
      actualModel: safeId(b.model),
      requestId: safeId(headers.get("request-id") || b.id),
    };
  },
};

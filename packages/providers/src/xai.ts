import { createMockAdapter, type VendorDefinition } from "./mock";
export const xai: VendorDefinition = {
  id: "xai",
  name: "Grok / xAI",
  mockId: "mock-xai",
  model: "mock-xai/structured-v1",
  capabilities: ["analysis", "review", "planning"],
  latencyMs: 100,
};
export const createXAIMock = () => createMockAdapter(xai);

import type { Wire } from "./transport";
import { jsonOutput, tokenCount, safeId } from "./transport";
export const xaiWire: Wire = {
  id: "xai",
  name: "xAI",
  endpoint: "https://api.x.ai",
  keyName: "ORBIT_XAI_API_KEY",
  build: (model, system, prompt, _schema, maxTokens) => ({
    path: "/v1/chat/completions",
    headers: {},
    body: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    },
  }),
  parse(raw, headers) {
    const b = raw as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
      id?: string;
    };
    return {
      output: jsonOutput(b.choices?.[0]?.message?.content),
      inputTokens: tokenCount(b.usage?.prompt_tokens),
      outputTokens: tokenCount(b.usage?.completion_tokens),
      actualModel: safeId(b.model),
      requestId: safeId(headers.get("x-request-id") || b.id),
    };
  },
};

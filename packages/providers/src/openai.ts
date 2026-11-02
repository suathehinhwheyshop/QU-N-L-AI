import { createMockAdapter, type VendorDefinition } from "./mock";
export const openai: VendorDefinition = {
  id: "openai",
  name: "GPT / OpenAI",
  mockId: "mock-openai",
  model: "mock-openai/structured-v1",
  capabilities: ["analysis", "review", "planning"],
  latencyMs: 60,
};
export const createOpenAIMock = () => createMockAdapter(openai);

import type { Wire } from "./transport";
import { jsonOutput, tokenCount, safeId } from "./transport";
export const openaiWire: Wire = {
  id: "openai",
  name: "OpenAI",
  endpoint: "https://api.openai.com",
  keyName: "ORBIT_OPENAI_API_KEY",
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
      max_completion_tokens: maxTokens,
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

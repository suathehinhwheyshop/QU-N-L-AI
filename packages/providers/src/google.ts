import { createMockAdapter, type VendorDefinition } from "./mock";
export const google: VendorDefinition = {
  id: "google",
  name: "Gemini / Google",
  mockId: "mock-google",
  model: "mock-google/structured-v1",
  capabilities: ["analysis", "review", "planning"],
  latencyMs: 80,
};
export const createGoogleMock = () => createMockAdapter(google);

import type { Wire } from "./transport";
import { jsonOutput, tokenCount, safeId } from "./transport";
export const googleWire: Wire = {
  id: "google",
  name: "Google Gemini",
  endpoint: "https://generativelanguage.googleapis.com",
  keyName: "ORBIT_GOOGLE_API_KEY",
  build: (model, system, prompt, _schema, maxTokens) => ({
    path:
      "/v1beta/models/" +
      encodeURIComponent(model.replace(/^models\//, "")) +
      ":generateContent",
    headers: {},
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: maxTokens,
      },
    },
  }),
  parse(raw, headers) {
    const b = raw as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
      modelVersion?: string;
      responseId?: string;
    };
    return {
      output: jsonOutput(
        b.candidates?.[0]?.content?.parts
          ?.filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join(""),
      ),
      inputTokens: tokenCount(b.usageMetadata?.promptTokenCount),
      outputTokens:
        tokenCount(b.usageMetadata?.candidatesTokenCount) +
        tokenCount(b.usageMetadata?.thoughtsTokenCount ?? 0),
      actualModel: safeId(b.modelVersion),
      requestId: safeId(headers.get("x-request-id") || b.responseId),
    };
  },
};

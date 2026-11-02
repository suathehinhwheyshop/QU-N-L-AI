import { OrbitError } from "@orbit/shared/contracts";
import type { ProviderAdapter } from "@orbit/core/registry";
export type VendorDefinition = {
  id: string;
  name: string;
  mockId: string;
  model: string;
  capabilities: string[];
  latencyMs: number;
};
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new OrbitError("TIMEOUT", true));
    const cleanup = () => signal.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      cleanup();
      reject(new OrbitError("TIMEOUT", true));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function createMockAdapter(
  definition: VendorDefinition,
): ProviderAdapter {
  return {
    descriptor: {
      id: definition.mockId,
      vendor: definition.id,
      mode: "MOCK",
      available: true,
      capabilities: definition.capabilities,
      model: definition.model,
      models: [definition.model],
      costCents: 0,
      latencyMs: definition.latencyMs,
      reliability: 1,
      dataPolicy: "local-only",
    },
    async health() {
      return { status: "MOCK", code: "MOCK_ADAPTER_OK" };
    },
    async invoke({ capability, data, attempt, scenario, signal }) {
      if (scenario === "fail-once" && attempt === 1)
        throw new OrbitError("PROVIDER_FAILURE", true);
      await wait(scenario === "timeout" ? 60000 : 40, signal);
      if (scenario === "invalid-output")
        return {
          output: { summary: 12 },
          costCents: 0,
          usage: { mock: true, vendor: definition.id },
        };
      const source = data.source as { site?: string };
      const fallback = {
        summary: "[MOCK] Bản kế hoạch minh họa theo yêu cầu.",
        findings: [
          {
            id: "TASK-01",
            title: "Kiểm tra nguồn đầu vào và lập kế hoạch",
            url: source?.site || "https://example.org",
            priority: "P1",
            reason:
              "Fixture chung để kiểm thử truyền dữ liệu, không phải nhận định AI thật.",
            evidence: "Nguồn MOCK " + data.source_sha256,
            acceptance:
              "Có nguồn dữ liệu, tiêu chí kiểm tra và phê duyệt của người dùng.",
          },
        ],
        limitations: ["Chỉ kiểm chứng orchestration bằng fixture."],
        source_sha256: data.source_sha256,
      };
      const output =
        capability === "review"
          ? {
              ...(data.analysis as object),
              reviewed: true,
              review_notes: [
                "[MOCK] Adapter độc lập đã nhận và phản biện fixture; không xác nhận sự thật bên ngoài.",
              ],
            }
          : structuredClone(data.fixture ?? fallback);
      return {
        output,
        costCents: 0,
        usage: {
          mock: true,
          vendor: definition.id,
          unit: "fixture_call",
          calls: 1,
        },
      };
    },
  };
}

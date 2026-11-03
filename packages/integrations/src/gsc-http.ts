import { fetch as request, EnvHttpProxyAgent } from "undici";
import { rootCertificates } from "node:tls";
import { readFileSync } from "node:fs";
import { OrbitError } from "@orbit/shared/contracts";
export type GscTransport = {
  kind: "GSC_API" | "HTTP_STUB";
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  api: string;
  token: string;
  revoke: string;
  authorize: string;
};
let dispatcher: EnvHttpProxyAgent | undefined;
export const officialGsc: GscTransport = {
  kind: "GSC_API",
  api: "https://searchconsole.googleapis.com/webmasters/v3",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  async fetch(url, init) {
    if (typeof window !== "undefined") throw new OrbitError("FORBIDDEN_EFFECT");
    if (!dispatcher) {
      const path =
        process.env.NODE_EXTRA_CA_CERTS || process.env.CODEX_PROXY_CERT;
      const ca = path
        ? [...rootCertificates, readFileSync(path, "utf8")]
        : undefined;
      dispatcher = new EnvHttpProxyAgent(
        ca ? { requestTls: { ca }, proxyTls: { ca } } : undefined,
      );
    }
    return (await request(url, {
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: typeof init.body === "string" ? init.body : undefined,
      signal: init.signal ?? undefined,
      redirect: "error",
      dispatcher,
    })) as unknown as Response;
  },
};
export class GscError extends OrbitError {
  constructor(
    code: string,
    retryable = false,
    public retryAfterMs = 0,
  ) {
    super(code, retryable);
  }
}
export async function gscHttp(
  transport: GscTransport,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await transport.fetch(url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      redirect: "error",
    });
  } catch {
    throw new GscError("GSC_TIMEOUT", true);
  }
  let body: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const x = await reader.read();
      if (x.done) break;
      bytes += x.value.length;
      if (bytes > 8_000_000) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(x.value);
    }
    const text = Buffer.concat(chunks).toString();
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new GscError("GSC_RESPONSE_INVALID");
  }
  if (!response.ok) {
    const b = body as { error?: { errors?: { reason?: string }[] } | string };
    const rate =
      response.status === 429 ||
      (response.status === 403 &&
        typeof b.error === "object" &&
        b.error.errors?.some((e) => /quota|rateLimit/i.test(e.reason ?? "")));
    if (rate) {
      const retry = response.headers.get("retry-after");
      const seconds = Number(retry);
      const ms =
        retry === null
          ? 1000
          : Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retry) - Date.now();
      throw new GscError(
        "GSC_RATE_LIMIT",
        true,
        Math.max(250, Math.min(30000, ms || 1000)),
      );
    }
    if (response.status === 401) throw new GscError("GSC_UNAUTHORIZED");
    if (response.status === 403) throw new GscError("GSC_FORBIDDEN");
    if (response.status === 400 && b.error === "invalid_grant")
      throw new GscError("GSC_REAUTH_REQUIRED");
    if (
      url === transport.revoke &&
      response.status === 400 &&
      b.error === "invalid_token"
    )
      return { revoked: true };
    throw new GscError(
      response.status >= 500 ? "GSC_UNAVAILABLE" : "GSC_REQUEST_REJECTED",
      response.status >= 500,
    );
  }
  return body;
}

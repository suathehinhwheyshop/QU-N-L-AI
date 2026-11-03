import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
export function observed<T>(
  handler: (request: NextRequest, context: T) => Promise<Response>,
) {
  return async (request: NextRequest, context: T) => {
    const requestId = randomUUID(),
      start = performance.now();
    const group = request.nextUrl.pathname.startsWith("/api/gsc/")
      ? "gsc"
      : "api";
    try {
      const response = await handler(request, context);
      response.headers.set("X-Request-ID", requestId);
      console.log(
        JSON.stringify({
          event: "http_request",
          request_id: requestId,
          group,
          method: request.method,
          status: response.status,
          duration_ms: Math.round(performance.now() - start),
        }),
      );
      return response;
    } catch {
      console.error(
        JSON.stringify({
          event: "http_request_failed",
          request_id: requestId,
          group,
          method: request.method,
        }),
      );
      return Response.json(
        { code: "INTERNAL_ERROR", request_id: requestId },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
        },
      );
    }
  };
}

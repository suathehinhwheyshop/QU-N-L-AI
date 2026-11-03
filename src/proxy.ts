import { NextRequest, NextResponse } from "next/server";
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = `default-src 'self';script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""};style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;font-src 'self';connect-src 'self'${dev ? " ws:" : ""};object-src 'none';base-uri 'none';form-action 'self';frame-ancestors 'none'`;
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import { readiness } from "@/server/health";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ check: string }> },
) {
  const { check } = await params;
  if (check === "live")
    return NextResponse.json(
      { status: "UP" },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (check !== "ready")
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  const ready = await readiness();
  return NextResponse.json(
    { status: ready ? "READY" : "NOT_READY" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

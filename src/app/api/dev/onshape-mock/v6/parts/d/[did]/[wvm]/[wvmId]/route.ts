import { NextResponse } from "next/server";

/**
 * Dev-gated stand-in for Onshape's `GET /v6/parts/d/{did}/{wvm}/{wvmId}`.
 * Fixed fixture, stable partIds so e2e can assert on them.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_ONSHAPE_MOCK !== "1") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  }

  return NextResponse.json([
    { partId: "JHD", name: "Left Drive Plate", material: { displayName: "6061 Aluminum" }, partNumber: "" },
    { partId: "JHK", name: "Spacer", material: { displayName: "Delrin" }, partNumber: "0102" },
    { partId: "JHV", name: "Gusset", material: { displayName: "6061 Aluminum" }, partNumber: "" },
  ]);
}

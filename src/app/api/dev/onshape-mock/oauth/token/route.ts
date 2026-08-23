import { NextResponse } from "next/server";

// ponytail: in-memory counter, fine for a dev-only mock (no persistence needed).
let callCount = 0;

/**
 * Dev-gated stand-in for Onshape's OAuth token endpoint. Ignores the actual
 * grant details (code / refresh_token) — always mints a fresh mock token pair
 * so the local connect/refresh flow can run with zero real Onshape dependency.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let grantType = "unknown";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { grant_type?: string } | null;
    grantType = body?.grant_type ?? grantType;
  } else {
    const text = await request.text().catch(() => "");
    grantType = new URLSearchParams(text).get("grant_type") ?? grantType;
  }

  const n = ++callCount;
  return NextResponse.json({
    access_token: `mock-access-${grantType}-${n}`,
    refresh_token: `mock-refresh-${grantType}-${n}`,
    expires_in: 3600,
  });
}

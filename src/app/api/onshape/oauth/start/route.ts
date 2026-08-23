import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { clientUrl } from "@/lib/request-origin";
import { buildAuthorizeUrl } from "@/lib/onshape";

// Shared literal with ../callback/route.ts (kept local — Next.js route.ts
// files may only export HTTP-verb handlers).
const ONSHAPE_OAUTH_STATE_COOKIE = "onshape_oauth_state";

// This runs in the first-party Connect popup (top-level navigation), so the
// normal hub cookies are present — a plain redirect (not a JSON 403) matches
// how other student+ pages gate unauthenticated visitors.
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) {
    return NextResponse.redirect(clientUrl(request, "/login"));
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildAuthorizeUrl(state), 307);
  response.cookies.set(ONSHAPE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}

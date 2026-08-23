import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { clientUrl } from "@/lib/request-origin";
import { exchangeCode, upsertConnection } from "@/lib/onshape";

// Shared literal with ../start/route.ts (kept local — Next.js route.ts files
// may only export HTTP-verb handlers).
const ONSHAPE_OAUTH_STATE_COOKIE = "onshape_oauth_state";

// Top-level redirect target from oauth.onshape.com — first-party, hub cookies
// present. Thin: exchange + upsert only, no panel-token minting here (that's
// the /onshape/connect page).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const toErrorRedirect = (response?: NextResponse) => {
    const err = NextResponse.redirect(clientUrl(request, "/onshape/connect?onshape=error"));
    response?.cookies.getAll().forEach((c) => err.cookies.set(c));
    return err;
  };

  if (error || !code) return toErrorRedirect();

  // CSRF: single-use state cookie, deleted regardless of outcome.
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(ONSHAPE_OAUTH_STATE_COOKIE)?.value;
  const clearStateCookie = (response: NextResponse) => {
    response.cookies.set(ONSHAPE_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };
  if (!state || !cookieState || state !== cookieState) {
    return clearStateCookie(toErrorRedirect());
  }

  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student") || !viewer.person) {
    return clearStateCookie(NextResponse.redirect(clientUrl(request, "/login")));
  }

  try {
    const tokens = await exchangeCode(code);
    await upsertConnection(viewer.person.id, tokens);
  } catch {
    return clearStateCookie(toErrorRedirect());
  }

  return clearStateCookie(
    NextResponse.redirect(clientUrl(request, "/onshape/connect?onshape=connected")),
  );
}

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { clientUrl } from "@/lib/request-origin";
import { githubAppCredentialsFromEnv } from "@/lib/github-app";

// Shared literal with ../callback/route.ts (kept local — Next.js route.ts
// files may only export HTTP-verb handlers).
const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";

// Mirrors onshape/oauth/start: first-party navigation, so a plain redirect
// (not a JSON 403) matches how other student+ pages gate unauthenticated
// visitors.
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student") || !viewer.person) {
    return NextResponse.redirect(clientUrl(request, "/login"));
  }

  const credentials = githubAppCredentialsFromEnv();
  if (!credentials) {
    return NextResponse.redirect(
      clientUrl(request, `/people/${viewer.person.id}?github=error`),
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = clientUrl(request, "/api/github/oauth/callback");
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", credentials.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri.toString());
  authorizeUrl.searchParams.set("state", state);
  // No `scope` param: GitHub App user tokens have no scopes.

  const response = NextResponse.redirect(authorizeUrl, 307);
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return response;
}

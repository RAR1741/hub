import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { clientUrl } from "@/lib/request-origin";
import { getDb } from "@/lib/db";
import { githubAppCredentialsFromEnv, githubHeaders } from "@/lib/github-app";
import { syncPersonLinkedTeams } from "@/lib/github-team-sync";

// Shared literal with ../start/route.ts (kept local — Next.js route.ts files
// may only export HTTP-verb handlers).
const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  // CSRF: single-use state cookie, deleted regardless of outcome.
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(GITHUB_OAUTH_STATE_COOKIE)?.value;
  const clearStateCookie = (response: NextResponse) => {
    response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };

  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student") || !viewer.person) {
    return clearStateCookie(NextResponse.redirect(clientUrl(request, "/login")));
  }

  const toErrorRedirect = (reason: "error" | "taken") =>
    clearStateCookie(
      NextResponse.redirect(clientUrl(request, `/people/${viewer.person!.id}?github=${reason}`)),
    );

  if (error || !code || !state || !cookieState || state !== cookieState) {
    return toErrorRedirect("error");
  }

  const credentials = githubAppCredentialsFromEnv();
  if (!credentials) return toErrorRedirect("error");

  try {
    const redirectUri = clientUrl(request, "/api/github/oauth/callback");
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: redirectUri.toString(),
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) return toErrorRedirect("error");

    const userRes = await fetch("https://api.github.com/user", {
      headers: githubHeaders(accessToken),
    });
    if (!userRes.ok) return toErrorRedirect("error");
    const user = (await userRes.json()) as { id?: number; login?: string };
    if (!user.id || !user.login) return toErrorRedirect("error");

    const db = getDb();
    const { error: updateError } = await db
      .from("person")
      .update({ github_login: user.login, github_user_id: user.id })
      .eq("id", viewer.person.id);
    if (updateError) {
      return toErrorRedirect(updateError.code === "23505" ? "taken" : "error");
    }

    await syncPersonLinkedTeams(viewer.person.id, db);
  } catch {
    return toErrorRedirect("error");
  }

  return clearStateCookie(
    NextResponse.redirect(clientUrl(request, `/people/${viewer.person.id}?github=connected`)),
  );
}

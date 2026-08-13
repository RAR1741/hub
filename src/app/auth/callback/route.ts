import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getDb } from "@/lib/db";
import { serverSupabaseUrl } from "@/lib/supabase-url";
import { AUTH_COOKIE_NAME } from "@/lib/supabase-cookie";
import { clientUrl } from "@/lib/request-origin";
import { decideOAuthLink } from "@/lib/oauth-link";
import type { PersonRow } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirect = NextResponse.redirect(clientUrl(request, "/"));
  if (!code) return redirect;

  // Preserves the auth cookies already attached to `redirect` (set below via
  // the Supabase client's setAll callback) when we need to redirect somewhere
  // else instead — e.g. on a failed person-link write.
  const toErrorRedirect = () => {
    const err = NextResponse.redirect(clientUrl(request, "/login?error=oauth"));
    redirect.cookies.getAll().forEach((c) => err.cookies.set(c));
    return err;
  };

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Must match the browser client's cookie name (supabase-cookie.ts) or the
      // PKCE code verifier written by the browser is unreadable here.
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            redirect.cookies.set(name, value, options),
          ),
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("oauth callback: code exchange failed", {
      hasCode: Boolean(code),
      error: error?.message ?? "no user returned",
    });
    return redirect;
  }

  const email = data.user.email?.toLowerCase();
  const db = getDb();

  const [
    { data: matched, error: matchedError },
    { count, error: countError },
    { count: linkedCount, error: linkedCountError },
    { data: firstAdmin, error: firstAdminError },
  ] = await Promise.all([
    email
      ? db.from("person").select("*").eq("email", email).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("person")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin"),
    // How many people already have a Google account attached. Zero = fresh setup.
    db
      .from("person")
      .select("id", { count: "exact", head: true })
      .not("auth_user_id", "is", null),
    // The first admin (earliest created) — the fresh-setup login adopts this one.
    db
      .from("person")
      .select("*")
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (matchedError) {
    console.error("oauth callback: failed to look up matched person", {
      email,
      authUserId: data.user.id,
      error: matchedError,
    });
    return toErrorRedirect();
  }

  // If we can't determine the current admin count, we must not risk
  // bootstrapping a new admin on a false "zero admins" reading — fail
  // closed (deny) rather than fail open (escalate).
  if (countError) {
    console.error("oauth callback: failed to determine admin count", {
      authUserId: data.user.id,
      error: countError,
    });
    return toErrorRedirect();
  }

  // A wrong "nobody linked yet" reading would wrongly adopt the admin account,
  // so if we can't determine the linked-account count, fail closed (deny) too.
  if (linkedCountError) {
    console.error("oauth callback: failed to determine linked-account count", {
      authUserId: data.user.id,
      error: linkedCountError,
    });
    return toErrorRedirect();
  }

  // A failed first-admin lookup only disables the fresh-setup adopt path
  // (firstAdmin stays null); normal email-match linking still proceeds.
  if (firstAdminError) {
    console.error("oauth callback: failed to look up the first admin", {
      authUserId: data.user.id,
      error: firstAdminError,
    });
  }

  const decision = decideOAuthLink({
    matchedPerson: matched ?? null,
    adminCount: count ?? 0,
    linkedCount: linkedCount ?? 0,
    firstAdmin: (firstAdmin as PersonRow | null) ?? null,
  });

  if (decision.action === "bootstrap-admin") {
    if (matched) {
      const { error: updateError } = await db
        .from("person")
        .update({ role: "admin", auth_user_id: data.user.id, is_active: true })
        .eq("id", matched.id);
      if (updateError) {
        console.error(
          "oauth callback: failed to promote matched person to admin",
          { personId: matched.id, authUserId: data.user.id, error: updateError },
        );
        return toErrorRedirect();
      }
    } else {
      const meta = (data.user.user_metadata ?? {}) as Record<string, string>;
      // Two simultaneous first-ever logins could both see adminCount === 0 and
      // both decide bootstrap-admin; the second insert here races against the
      // first. That's caught by the `person.email` unique constraint and
      // surfaced below as an insertError (redirect to /login?error=oauth)
      // rather than silently double-provisioning an admin.
      const { error: insertError } = await db.from("person").insert({
        first_name: meta.given_name ?? meta.name ?? "Admin",
        last_name: meta.family_name ?? "",
        // person.email is the OAuth allowlist key — always store lowercased
        // so case-insensitive match holds.
        email,
        role: "admin",
        auth_user_id: data.user.id,
      });
      if (insertError) {
        console.error("oauth callback: failed to insert bootstrap admin", {
          email,
          authUserId: data.user.id,
          error: insertError,
        });
        return toErrorRedirect();
      }
    }
  } else if (decision.action === "adopt-admin") {
    // Fresh setup: attach this login to the first admin, but only while it's
    // still unlinked. The `.is auth_user_id null` guard makes two simultaneous
    // first logins safe — the loser updates nothing and simply stays a guest.
    const { data: adopted, error: adoptError } = await db
      .from("person")
      .update({ auth_user_id: data.user.id, is_active: true })
      .eq("id", decision.personId!)
      .is("auth_user_id", null)
      .select("id");
    if (adoptError) {
      console.error("oauth callback: failed to adopt the first admin", {
        personId: decision.personId,
        authUserId: data.user.id,
        error: adoptError,
      });
      return toErrorRedirect();
    }
    if (!adopted || adopted.length === 0) {
      // Another first login adopted it first — this user stays a guest.
      console.warn(
        "oauth callback: first admin already adopted by a concurrent login",
        { personId: decision.personId, authUserId: data.user.id },
      );
    }
  } else if (decision.action === "link") {
    const { error: linkError } = await db
      .from("person")
      .update({ auth_user_id: data.user.id })
      .eq("id", decision.personId!);
    if (linkError) {
      console.error("oauth callback: failed to link person", {
        personId: decision.personId,
        authUserId: data.user.id,
        error: linkError,
      });
      return toErrorRedirect();
    }
  }
  // "guest": session exists but links to no person → getViewer() returns guest.

  return redirect;
}

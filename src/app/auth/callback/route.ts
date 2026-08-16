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
    { data: matchedIdentity, error: matchedError },
    { count, error: countError },
    { count: linkedCount, error: linkedCountError },
    { data: firstAdmin, error: firstAdminError },
  ] = await Promise.all([
    email
      ? db
          .from("person_identity")
          .select("id, auth_user_id, person (*)")
          .eq("email", email)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("person")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin"),
    // How many Google accounts are attached anywhere. Zero = fresh setup.
    db
      .from("person_identity")
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

  type IdentityMatch = {
    id: string;
    auth_user_id: string | null;
    person: PersonRow | PersonRow[] | null;
  };
  const identity = (matchedIdentity as IdentityMatch | null) ?? null;
  const matchedPerson = identity
    ? ((Array.isArray(identity.person) ? identity.person[0] : identity.person) ?? null)
    : null;

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
    matchedPerson,
    adminCount: count ?? 0,
    linkedCount: linkedCount ?? 0,
    firstAdmin: (firstAdmin as PersonRow | null) ?? null,
  });

  if (decision.action === "bootstrap-admin") {
    if (matchedPerson) {
      const { error: updateError } = await db
        .from("person")
        .update({ role: "admin", is_active: true })
        .eq("id", matchedPerson.id);
      if (updateError) {
        console.error(
          "oauth callback: failed to promote matched person to admin",
          {
            personId: matchedPerson.id,
            authUserId: data.user.id,
            error: updateError,
          },
        );
        return toErrorRedirect();
      }
      const { error: linkError } = await db
        .from("person_identity")
        .update({ auth_user_id: data.user.id })
        .eq("id", identity!.id)
        .is("auth_user_id", null);
      if (linkError) {
        console.error("oauth callback: failed to link bootstrap admin identity", {
          identityId: identity!.id,
          authUserId: data.user.id,
          error: linkError,
        });
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
        // so case-insensitive match holds. The Task 1 trigger mirrors this into
        // a primary person_identity row, which we attach the login to below.
        email,
        role: "admin",
      });
      if (insertError) {
        console.error("oauth callback: failed to insert bootstrap admin", {
          email,
          authUserId: data.user.id,
          error: insertError,
        });
        return toErrorRedirect();
      }
      const { error: attachError } = await db
        .from("person_identity")
        .update({ auth_user_id: data.user.id })
        .eq("email", email!)
        .is("auth_user_id", null);
      if (attachError) {
        console.error("oauth callback: failed to attach bootstrap admin identity", {
          email,
          authUserId: data.user.id,
          error: attachError,
        });
        return toErrorRedirect();
      }
    }
  } else if (decision.action === "adopt-admin") {
    // Fresh setup: attach this login to the first admin's primary identity,
    // but only while it's unlinked — the .is() guard keeps two simultaneous
    // first logins safe (the loser matches nothing and stays a guest).
    const { data: adopted, error: adoptError } = await db
      .from("person_identity")
      .update({ auth_user_id: data.user.id })
      .eq("person_id", decision.personId!)
      .eq("is_primary", true)
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
    if (adopted && adopted.length > 0) {
      const { error: activateError } = await db
        .from("person")
        .update({ is_active: true })
        .eq("id", decision.personId!);
      if (activateError) {
        console.error("oauth callback: failed to activate the first admin", {
          personId: decision.personId,
          authUserId: data.user.id,
          error: activateError,
        });
        return toErrorRedirect();
      }
    } else if (email) {
      // First admin has no (unlinked) primary identity — e.g. seeded with no
      // email. Insert one; the one-primary partial unique index and the email
      // unique constraint make a concurrent duplicate fail loudly.
      const { error: insertError } = await db.from("person_identity").insert({
        person_id: decision.personId!,
        email,
        auth_user_id: data.user.id,
        is_primary: true,
      });
      if (insertError) {
        console.warn("oauth callback: first admin already adopted by a concurrent login", {
          personId: decision.personId,
          authUserId: data.user.id,
          error: insertError,
        });
        // stays a guest — same outcome as today's lost race
      } else {
        const { error: activateError } = await db
          .from("person")
          .update({ is_active: true, email })
          .eq("id", decision.personId!);
        if (activateError) {
          console.error("oauth callback: failed to activate the first admin", {
            personId: decision.personId,
            authUserId: data.user.id,
            error: activateError,
          });
          return toErrorRedirect();
        }
        // note: setting person.email fires the mirror trigger, which finds the
        // identity we just inserted and simply promotes it (already primary) — safe.
      }
    } else {
      console.warn("oauth callback: adopt-admin skipped — login has no email", {
        personId: decision.personId,
        authUserId: data.user.id,
      });
    }
  } else if (decision.action === "link") {
    // Repeat login by an already-linked account is a no-op success.
    if (identity!.auth_user_id === data.user.id) return redirect;
    // Same email suddenly presenting a DIFFERENT auth user (e.g. the Supabase
    // auth user was deleted and re-created) must never silently steal the
    // identity — fail loudly. Q5 in issue #32.
    if (identity!.auth_user_id !== null) {
      console.error("oauth callback: identity email already linked to another auth user", {
        identityId: identity!.id,
        email,
        authUserId: data.user.id,
      });
      return toErrorRedirect();
    }
    const { data: linked, error: linkError } = await db
      .from("person_identity")
      .update({ auth_user_id: data.user.id })
      .eq("id", identity!.id)
      .is("auth_user_id", null)
      .select("id");
    if (linkError) {
      console.error("oauth callback: failed to link identity", {
        identityId: identity!.id,
        authUserId: data.user.id,
        error: linkError,
      });
      return toErrorRedirect();
    }
    if (!linked || linked.length === 0) {
      // Concurrent login won the race — fail loudly rather than guess.
      console.error("oauth callback: identity linked concurrently", {
        identityId: identity!.id,
        authUserId: data.user.id,
      });
      return toErrorRedirect();
    }
  }
  // "guest": session exists but links to no person → getViewer() returns guest.

  return redirect;
}

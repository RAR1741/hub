import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getDb } from "@/lib/db";
import { serverSupabaseUrl } from "@/lib/supabase-url";
import { decideOAuthLink } from "@/lib/oauth-link";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirect = NextResponse.redirect(new URL("/", request.url));
  if (!code) return redirect;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
  if (error || !data.user) return redirect;

  const email = data.user.email?.toLowerCase();
  const db = getDb();

  const [{ data: matched }, { count }] = await Promise.all([
    email
      ? db.from("person").select("*").eq("email", email).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("person")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin"),
  ]);

  const decision = decideOAuthLink({
    matchedPerson: matched ?? null,
    adminCount: count ?? 0,
  });

  if (decision.action === "bootstrap-admin") {
    if (matched) {
      await db
        .from("person")
        .update({ role: "admin", auth_user_id: data.user.id })
        .eq("id", matched.id);
    } else {
      const meta = (data.user.user_metadata ?? {}) as Record<string, string>;
      await db.from("person").insert({
        first_name: meta.given_name ?? meta.name ?? "Admin",
        last_name: meta.family_name ?? "",
        email,
        role: "admin",
        auth_user_id: data.user.id,
      });
    }
  } else if (decision.action === "link") {
    await db
      .from("person")
      .update({ auth_user_id: data.user.id })
      .eq("id", decision.personId!);
  }
  // "guest": session exists but links to no person → getViewer() returns guest.

  return redirect;
}

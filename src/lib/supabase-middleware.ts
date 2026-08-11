import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveServerSupabaseUrl } from "./supabase-url";

/**
 * Refresh the Supabase auth session (if any) and write refreshed cookies
 * through to the response. getViewer()'s cookie adapter is read-only, so this
 * middleware is the only place expired-but-refreshable mentor sessions get
 * renewed server-side.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No Supabase auth cookies → nothing to refresh (students/guests skip the network hop).
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) return response;

  const supabase = createServerClient(
    resolveServerSupabaseUrl({
      SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers the refresh when the access token is expired.
  await supabase.auth.getUser();

  return response;
}

import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME } from "./supabase-cookie";

export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Pin the cookie name so it matches the server clients despite the
    // browser/server URL split (see supabase-cookie.ts).
    { cookieOptions: { name: AUTH_COOKIE_NAME } },
  );
}

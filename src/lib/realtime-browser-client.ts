import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Realtime-only browser client singleton. Deliberately NOT the `@supabase/ssr`
 * auth client (see supabase-browser.ts) — no auth persistence, no cookies, so
 * the AUTH_COOKIE_NAME seam is untouched. Returns null if the public env vars
 * aren't configured; callers (useRealtimeRefetch) must degrade to polling.
 */
export function browserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  return client;
}

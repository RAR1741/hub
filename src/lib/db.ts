import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSupabaseUrl } from "./supabase-url";

let db: SupabaseClient | undefined;

/** Service-role client. Server-only — bypasses RLS by design (spec §3.5). */
export function getDb(): SupabaseClient {
  if (!db) {
    db = createClient(
      serverSupabaseUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return db;
}

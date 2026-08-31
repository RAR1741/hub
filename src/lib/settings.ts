import type { SupabaseClient } from "@supabase/supabase-js";

export async function getSetting<T>(
  key: string,
  fallback: T,
  db?: SupabaseClient,
): Promise<T> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("app_setting")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || data == null) return fallback;
  return data.value as T;
}

export const DEFAULT_TEAM_TIMEZONE = "America/Indiana/Indianapolis";

export function getTeamTimezone(db?: SupabaseClient): Promise<string> {
  return getSetting<string>("team_timezone", DEFAULT_TEAM_TIMEZONE, db);
}

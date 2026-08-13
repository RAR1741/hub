import type { SupabaseClient } from "@supabase/supabase-js";
import { getActivePeriod } from "./periods";
import { displayName } from "./people";

export type ClockResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

export async function clockIn(personId: string, db?: SupabaseClient): Promise<ClockResult> {
  const client = db ?? (await import("./db")).getDb();
  const period = await getActivePeriod(client);
  if (!period) return { ok: false, status: 409, reason: "no_active_period" };
  const { error } = await client
    .from("session")
    .insert({ person_id: personId, period_id: period.id, source: "kiosk" });
  if (error) {
    // The partial unique index rejects a second open session for the same person.
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409, reason: "already_in" };
    // A bad/nonexistent person_id fails the FK — that's a bad request, not a server error.
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 400, reason: "invalid_person" };
    return { ok: false, status: 500, reason: "db_error" };
  }
  return { ok: true };
}

export async function clockOut(personId: string, db?: SupabaseClient): Promise<ClockResult> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .update({ time_out: new Date().toISOString() })
    .eq("person_id", personId)
    .is("time_out", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, reason: "db_error" };
  if (!data) return { ok: false, status: 404, reason: "not_in" };
  return { ok: true };
}

export type WhosHereEntry = { personId: string; name: string; since: string };

export async function listWhosHere(db?: SupabaseClient): Promise<WhosHereEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .select("time_in, person!person_id (id, first_name, last_name, display_name)")
    .is("time_out", null)
    .order("time_in");
  if (error) console.error("listWhosHere: query failed", error);
  return (data ?? [])
    .filter((r) => r.person)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      return { personId: p.id, name: displayName(p), since: r.time_in as string };
    });
}

/** Active members not currently clocked in — the kiosk sign-in grid. */
export async function activeMembersForKiosk(
  db?: SupabaseClient,
): Promise<{ id: string; name: string }[]> {
  const client = db ?? (await import("./db")).getDb();
  const [{ data: people }, { data: open }] = await Promise.all([
    client.from("person").select("id, first_name, last_name, display_name").eq("is_active", true),
    client.from("session").select("person_id").is("time_out", null),
  ]);
  const openIds = new Set((open ?? []).map((s) => s.person_id as string));
  return (people ?? [])
    .filter((p) => !openIds.has(p.id as string))
    .map((p) => ({
      id: p.id as string,
      name: displayName(p as unknown as { first_name: string; last_name: string; display_name: string | null }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

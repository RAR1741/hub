import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, SessionRow } from "./types";
import { sessionFromRow } from "./types";
import { totalHours } from "./hours";
import { displayName } from "./people";

export type LeaderboardEntry = {
  personId: string;
  name: string;
  hours: number;
  sessionCount: number;
};

/** Per-person totals, sorted by hours desc then name. PURE. */
export function leaderboard(
  rows: { personId: string; name: string; sessions: Session[] }[],
): LeaderboardEntry[] {
  return rows
    .map((r) => ({
      personId: r.personId,
      name: r.name,
      hours: Math.round(totalHours(r.sessions) * 100) / 100,
      sessionCount: r.sessions.length,
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

export async function personSessions(
  personId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<Session[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*")
    .eq("person_id", personId)
    .eq("period_id", periodId)
    .order("time_in", { ascending: false });
  return ((data ?? []) as SessionRow[]).map(sessionFromRow);
}

export async function periodLeaderboard(
  periodId: string,
  db?: SupabaseClient,
): Promise<LeaderboardEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*, person (id, first_name, last_name, display_name)")
    .eq("period_id", periodId);
  const byPerson = new Map<string, { name: string; sessions: Session[] }>();
  for (const row of data ?? []) {
    const p = row.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null;
    } | null;
    if (!p) continue;
    const entry = byPerson.get(p.id) ?? { name: displayName(p), sessions: [] };
    entry.sessions.push(sessionFromRow(row as unknown as SessionRow));
    byPerson.set(p.id, entry);
  }
  return leaderboard(
    [...byPerson.entries()].map(([personId, v]) => ({ personId, name: v.name, sessions: v.sessions })),
  );
}

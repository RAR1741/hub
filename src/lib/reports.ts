import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, SessionRow } from "./types";
import { sessionFromRow } from "./types";
import { totalHours, overlappingSessionIds, sessionFlags, type FlagKind } from "./hours";
import { displayName } from "./people";
import { getSetting } from "./settings";

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

export type FlaggedSession = {
  session: Session;
  name: string;
  flags: FlagKind[];
  overlapping: boolean;
};

export async function flaggedSessions(
  periodId: string,
  db?: SupabaseClient,
): Promise<FlaggedSession[]> {
  const client = db ?? (await import("./db")).getDb();
  const maxShift = await getSetting<number>("max_shift_hours", 18, client);
  const { data } = await client
    .from("session")
    .select("*, person (id, first_name, last_name, display_name)")
    .eq("period_id", periodId)
    .order("time_in", { ascending: false });

  const sessions = (data ?? []).map((r) => sessionFromRow(r as unknown as SessionRow));
  const overlaps = overlappingSessionIds(sessions);
  const nameById = new Map<string, string>();
  for (const r of data ?? []) {
    const p = r.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null;
    } | null;
    if (p) nameById.set(p.id, displayName(p));
  }

  const out: FlaggedSession[] = [];
  for (const s of sessions) {
    const flags = sessionFlags(s, maxShift);
    const overlapping = overlaps.has(s.id);
    if (flags.length === 0 && !overlapping) continue;
    out.push({ session: s, name: nameById.get(s.personId) ?? "Unknown", flags, overlapping });
  }
  return out;
}

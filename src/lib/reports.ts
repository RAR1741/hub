import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, SessionRow, Role } from "./types";
import { sessionFromRow } from "./types";
import { totalHours, overlappingSessionIds, sessionFlags, type FlagKind } from "./hours";
import { displayName, listPeople } from "./people";
import { getSetting } from "./settings";

export type LeaderboardEntry = {
  personId: string;
  name: string;
  firstName: string;
  lastName: string;
  role: Role;
  hours: number;
  sessionCount: number;
};

/** Per-person totals, sorted by hours desc then name. PURE. */
export function leaderboard(
  rows: {
    personId: string;
    name: string;
    firstName: string;
    lastName: string;
    role: Role;
    sessions: Session[];
  }[],
): LeaderboardEntry[] {
  return rows
    .map((r) => ({
      personId: r.personId,
      name: r.name,
      firstName: r.firstName,
      lastName: r.lastName,
      role: r.role,
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

/** Total (rounded) non-excluded hours for ONE person in a period. Avoids a full leaderboard scan. */
export async function personPeriodHours(
  personId: string,
  periodId: string,
  db?: SupabaseClient,
): Promise<number> {
  const sessions = await personSessions(personId, periodId, db);
  return Math.round(totalHours(sessions) * 100) / 100;
}

export async function periodLeaderboard(
  periodId: string,
  db?: SupabaseClient,
): Promise<LeaderboardEntry[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("session")
    .select("*, person!person_id (id, first_name, last_name, display_name, role)")
    .eq("period_id", periodId);
  if (error) console.error("periodLeaderboard: query failed", error);
  const byPerson = new Map<
    string,
    { name: string; firstName: string; lastName: string; role: Role; sessions: Session[] }
  >();
  for (const row of data ?? []) {
    const p = row.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null; role: Role;
    } | null;
    if (!p) continue;
    const entry =
      byPerson.get(p.id) ?? {
        name: displayName(p),
        firstName: p.first_name,
        lastName: p.last_name,
        role: p.role,
        sessions: [],
      };
    entry.sessions.push(sessionFromRow(row as unknown as SessionRow));
    byPerson.set(p.id, entry);
  }
  return leaderboard(
    [...byPerson.entries()].map(([personId, v]) => ({
      personId,
      name: v.name,
      firstName: v.firstName,
      lastName: v.lastName,
      role: v.role,
      sessions: v.sessions,
    })),
  );
}

export type HoursReportRow = {
  personId: string;
  name: string;
  studentId: string | null;
  hours: number;
};

/**
 * Hours report for every active person in a period, including people with
 * zero logged sessions (unlike `periodLeaderboard`, which only lists people
 * who show up in the `session` rows for the period). Sorted like the
 * leaderboard: hours desc, then name.
 */
export async function hoursReportForPeriod(
  periodId: string,
  db?: SupabaseClient,
): Promise<HoursReportRow[]> {
  const client = db ?? (await import("./db")).getDb();
  const [entries, peopleRows] = await Promise.all([
    periodLeaderboard(periodId, client),
    listPeople(undefined, client),
  ]);
  const hoursByPerson = new Map(entries.map((e) => [e.personId, e.hours]));
  return peopleRows
    .filter((p) => p.is_active)
    .map((p) => ({
      personId: p.id,
      name: displayName(p),
      studentId: p.student_id_number,
      hours: hoursByPerson.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
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
  const { data, error } = await client
    .from("session")
    .select("*, person!person_id (id, first_name, last_name, display_name)")
    .eq("period_id", periodId)
    .order("time_in", { ascending: false });
  if (error) console.error("flaggedSessions: query failed", error);

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

export type SessionWithName = Session & { name: string };

/**
 * Sessions in a period, optionally filtered to one person, newest first, each
 * carrying the member's display name — for the all-sessions admin view. Uses
 * the `person!person_id` FK-hint embed (person is also referenced by
 * session.edited_by, so an unqualified embed is ambiguous and PostgREST
 * rejects it with PGRST201).
 */
export async function listSessionsForPeriod(
  periodId: string,
  personId?: string,
  db?: SupabaseClient,
): Promise<SessionWithName[]> {
  const client = db ?? (await import("./db")).getDb();
  let query = client
    .from("session")
    .select("*, person!person_id (id, first_name, last_name, display_name)")
    .eq("period_id", periodId);
  if (personId) query = query.eq("person_id", personId);
  const { data, error } = await query.order("time_in", { ascending: false });
  if (error) console.error("listSessionsForPeriod: query failed", error);
  return (data ?? []).map((row) => {
    const p = row.person as unknown as {
      id: string; first_name: string; last_name: string; display_name: string | null;
    } | null;
    return {
      ...sessionFromRow(row as unknown as SessionRow),
      name: p ? displayName(p) : "Unknown",
    };
  });
}

/** All sessions in a period (raw, all people) — for the attendance grid. */
export async function sessionsForPeriod(
  periodId: string,
  db?: SupabaseClient,
): Promise<Session[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("session")
    .select("*")
    .eq("period_id", periodId)
    .order("time_in");
  return ((data ?? []) as SessionRow[]).map(sessionFromRow);
}

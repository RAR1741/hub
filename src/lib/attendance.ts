import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildDay, BuildDayKind, Excusal, PeriodRow, Session } from "./types";
import { periodFromRow } from "./types";
import { listBuildDays } from "./build-days";
import { listExcusals } from "./excusals";
import { sessionsForPeriod } from "./reports";
import { getTeamTimezone } from "./settings";
import { displayName, listPeople } from "./people";

/** The team-local YYYY-MM-DD for a UTC instant. en-CA formats as YYYY-MM-DD. */
export function localDateOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The local date a session's time_in belongs to. */
export function sessionLocalDate(session: Pick<Session, "timeIn">, tz: string): string {
  return localDateOf(session.timeIn, tz);
}

export type AttendanceStatus = "present" | "excused" | "optional" | "absent";

/** True if a non-excluded session for `personId` is attributed to local date `date`. */
function isPresent(
  personId: string,
  date: string,
  sessions: Session[],
  tz: string,
): boolean {
  for (const s of sessions) {
    if (s.personId !== personId || s.excludedFromTotals) continue;
    if (sessionLocalDate(s, tz) === date) return true;
  }
  return false;
}

export function attendanceForDate(
  personId: string,
  date: string,
  kind: BuildDayKind,
  sessions: Session[],
  excusals: Excusal[],
  tz: string,
): AttendanceStatus {
  if (isPresent(personId, date, sessions, tz)) return "present";
  if (excusals.some((e) => e.personId === personId && e.date === date)) return "excused";
  if (kind === "optional") return "optional";
  return "absent";
}

export type AttendanceSummary = {
  present: number;
  excused: number;
  optional: number;
  absent: number;
  denominator: number;
  percentage: number | null;
};

export function attendanceSummary(
  personId: string,
  buildDays: BuildDay[],
  sessions: Session[],
  excusals: Excusal[],
  tz: string,
): AttendanceSummary {
  let present = 0;
  let excused = 0;
  let optional = 0;
  let absent = 0;
  for (const d of buildDays) {
    // Optional days never contribute to the numerator or denominator, even if attended.
    if (d.kind === "optional") {
      optional += 1;
      continue;
    }
    const status = attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz);
    if (status === "present") present += 1;
    else if (status === "excused") excused += 1;
    else absent += 1;
  }
  // Required days only; excused (and optional) excluded from the denominator.
  const denominator = present + absent;
  const percentage =
    denominator === 0 ? null : Math.round((present / denominator) * 10000) / 100;
  return { present, excused, optional, absent, denominator, percentage };
}

export type PeriodAttendanceSummary = {
  personId: string;
  name: string;
  present: number;
  excused: number;
  absent: number;
  /** Required build days in the period (present + excused + absent; optional days never count). */
  requiredDays: number;
  percentage: number | null;
};

/**
 * Per-active-person attendance summary over a whole period's required build
 * days. Composes the existing `attendanceSummary`/`attendanceForDate` math —
 * this function only fetches and fans the data out per person, it doesn't
 * change how a day is scored. Returns `[]` if the period doesn't exist.
 */
export async function attendanceSummaryForPeriod(
  periodId: string,
  db?: SupabaseClient,
): Promise<PeriodAttendanceSummary[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data: periodRow } = await client
    .from("period")
    .select("*")
    .eq("id", periodId)
    .maybeSingle();
  if (!periodRow) return [];
  const period = periodFromRow(periodRow as PeriodRow);
  const range = { from: period.startsOn, to: period.endsOn };

  const [buildDays, excusals, sessions, tz, peopleRows] = await Promise.all([
    listBuildDays(range, client),
    listExcusals(range, client),
    sessionsForPeriod(periodId, client),
    getTeamTimezone(client),
    listPeople(undefined, client),
  ]);

  return peopleRows
    .filter((p) => p.is_active)
    .map((p) => {
      const personId = p.id;
      const personSessions = sessions.filter((s) => s.personId === personId);
      const personExcusals = excusals.filter((e) => e.personId === personId);
      const summary = attendanceSummary(personId, buildDays, personSessions, personExcusals, tz);
      return {
        personId,
        name: displayName(p),
        present: summary.present,
        excused: summary.excused,
        absent: summary.absent,
        requiredDays: summary.present + summary.excused + summary.absent,
        percentage: summary.percentage,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

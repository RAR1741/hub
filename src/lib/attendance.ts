import type { BuildDay, BuildDayKind, Excusal, Session } from "./types";

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

/** True if a non-excluded session for `personId` overlaps local date `date`. */
function isPresent(
  personId: string,
  date: string,
  sessions: Session[],
  tz: string,
): boolean {
  for (const s of sessions) {
    if (s.personId !== personId || s.excludedFromTotals) continue;
    const start = localDateOf(s.timeIn, tz);
    const end = localDateOf(s.timeOut ?? s.timeIn, tz);
    if (start <= date && date <= end) return true; // ISO-date string comparison
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
    const status = attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz);
    if (status === "present") present += 1;
    else if (status === "excused") excused += 1;
    else if (status === "optional") optional += 1;
    else absent += 1;
  }
  // Required days only; excused (and optional) excluded from the denominator.
  const denominator = present + absent;
  const percentage =
    denominator === 0 ? null : Math.round((present / denominator) * 10000) / 100;
  return { present, excused, optional, absent, denominator, percentage };
}

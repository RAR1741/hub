import type { Session } from "./types";

const MS_PER_HOUR = 3_600_000;

export function sessionHours(
  s: Pick<Session, "timeIn" | "timeOut">,
  now: () => number = Date.now,
): number {
  const start = Date.parse(s.timeIn);
  const end = s.timeOut ? Date.parse(s.timeOut) : now();
  return Math.max(0, (end - start) / MS_PER_HOUR);
}

/** Sum of closed, non-excluded sessions. Open sessions don't count toward totals. */
export function totalHours(sessions: Session[]): number {
  return sessions
    .filter((s) => s.timeOut && !s.excludedFromTotals)
    .reduce((sum, s) => sum + sessionHours(s), 0);
}

export type FlagKind = "over_max" | "still_open" | "auto_closed";

export function sessionFlags(
  s: Session,
  maxShiftHours: number,
  now: () => number = Date.now,
): FlagKind[] {
  const flags: FlagKind[] = [];
  if (!s.timeOut) flags.push("still_open");
  if (sessionHours(s, now) > maxShiftHours) flags.push("over_max");
  if (s.timeOut && s.editedAt && !s.editedBy) flags.push("auto_closed");
  return flags;
}

/** Ids of sessions overlapping another session for the SAME person. */
export function overlappingSessionIds(sessions: Session[]): Set<string> {
  const ids = new Set<string>();
  const byPerson = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byPerson.get(s.personId) ?? [];
    list.push(s);
    byPerson.set(s.personId, list);
  }
  for (const list of byPerson.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aStart = Date.parse(a.timeIn);
        const aEnd = a.timeOut ? Date.parse(a.timeOut) : Infinity;
        const bStart = Date.parse(b.timeIn);
        const bEnd = b.timeOut ? Date.parse(b.timeOut) : Infinity;
        if (aStart < bEnd && bStart < aEnd) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
  }
  return ids;
}

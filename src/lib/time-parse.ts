export const TIME_ANOMALY_THRESHOLD_MIN = 240; // 4h — catches AM/PM (12h) and tz (~5h) slips
export const MAX_SHIFT_MIN = 1080;             // 18h, matches the max_shift_hours default

export type ClockParse =
  | { kind: "confident"; minutes: number }
  | { kind: "ambiguous"; am: number; pm: number }
  | { kind: "excused" }
  | { kind: "empty" }
  | { kind: "unparseable"; raw: string };

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

/** Parse one cell. PURE. */
export function parseClockToken(raw: string): ClockParse {
  const s = raw.trim();
  if (s === "") return { kind: "empty" };
  if (s.toLowerCase() === "excused") return { kind: "excused" };
  const m = TIME_RE.exec(s);
  if (!m) return { kind: "unparseable", raw: s };
  const hour = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[4]?.toLowerCase();
  if (min > 59) return { kind: "unparseable", raw: s };

  if (ampm) {
    if (hour < 1 || hour > 12) return { kind: "unparseable", raw: s };
    const base = (hour % 12) * 60 + min;
    return { kind: "confident", minutes: ampm === "pm" ? base + 720 : base };
  }
  if (hour > 23) return { kind: "unparseable", raw: s };
  // 0 and 13..23 are unambiguous 24-hour; 1..12 could be AM or PM.
  if (hour === 0 || hour > 12) return { kind: "confident", minutes: hour * 60 + min };
  return { kind: "ambiguous", am: (hour % 12) * 60 + min, pm: (hour % 12) * 60 + min + 720 };
}

export type ResolvedCell = { minutes: number | null; farFromColumn: boolean };

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Two-pass column consensus over one sub-column (same index across people). PURE. */
export function resolveColumnTimes(parses: ClockParse[]): ResolvedCell[] {
  const ref = median(parses.flatMap((p) => (p.kind === "confident" ? [p.minutes] : [])));
  return parses.map((p) => {
    if (p.kind === "confident") {
      return { minutes: p.minutes, farFromColumn: ref !== null && Math.abs(p.minutes - ref) > TIME_ANOMALY_THRESHOLD_MIN };
    }
    if (p.kind === "ambiguous") {
      const chosen = ref === null || Math.abs(p.am - ref) <= Math.abs(p.pm - ref) ? p.am : p.pm;
      return { minutes: chosen, farFromColumn: ref !== null && Math.abs(chosen - ref) > TIME_ANOMALY_THRESHOLD_MIN };
    }
    return { minutes: null, farFromColumn: false };
  });
}

export const TIME_ANOMALY_THRESHOLD_MIN = 240; // 4h floor — a lone slip in a tight column still flags
export const OUTLIER_MAD_K = 5;                // spread multiplier: threshold = max(floor, K * MAD)
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

/**
 * Spread-aware outlier band for a column of resolved minutes: max(floor, K * MAD).
 * On a tight column MAD is tiny so the floor governs (a lone 5h slip still flags);
 * on a genuinely spread column (e.g. all-day sessions with morning + afternoon
 * arrivals) the MAD term widens the band so normal spread isn't flagged. PURE.
 */
export function columnFlagThreshold(mins: number[]): number {
  const med = median(mins);
  if (med === null) return Infinity;
  const mad = median(mins.map((v) => Math.abs(v - med))) ?? 0;
  return Math.max(TIME_ANOMALY_THRESHOLD_MIN, OUTLIER_MAD_K * mad);
}

/**
 * Two-pass column resolution over one sub-column (same index across people).
 * Pass 1 resolves each ambiguous cell's AM/PM toward the confident median.
 * Pass 2 flags outliers against the *resolved* value distribution (which
 * includes the resolved-ambiguous cells, so a column that is mostly bare
 * morning times isn't judged against a lone 24-hour straggler). PURE.
 */
export function resolveColumnTimes(parses: ClockParse[]): ResolvedCell[] {
  const ref = median(parses.flatMap((p) => (p.kind === "confident" ? [p.minutes] : [])));
  const resolved = parses.map((p) => {
    if (p.kind === "confident") return p.minutes;
    if (p.kind === "ambiguous") return ref === null || Math.abs(p.am - ref) <= Math.abs(p.pm - ref) ? p.am : p.pm;
    return null;
  });
  const mins = resolved.filter((m): m is number => m !== null);
  const colMed = median(mins);
  const thr = columnFlagThreshold(mins);
  return resolved.map((m) => ({
    minutes: m,
    farFromColumn: m !== null && colMed !== null && Math.abs(m - colMed) > thr,
  }));
}

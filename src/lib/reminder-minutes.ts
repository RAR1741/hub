// src/lib/reminder-minutes.ts
// Pure module: no DB, no server imports. Client components import this directly.

export const REMINDER_MINUTES = [15, 30, 60, 120] as const;
export type ReminderMinutes = (typeof REMINDER_MINUTES)[number];

export const REMINDER_LABELS: Record<ReminderMinutes, string> = {
  15: "15 min",
  30: "30 min",
  60: "1 hour",
  120: "2 hours",
};

/** Max lead time; the sweep window. */
export const MAX_REMINDER_MS = 120 * 60_000;

const VALID = new Set<number>(REMINDER_MINUTES);

/**
 * Parse an arbitrary JSON value into a sorted, deduped offset list.
 * `undefined`/`null` -> `[]` (field omitted / no reminders).
 * Non-array, or any member not in {15,30,60,120} -> `null` (caller returns 400).
 */
export function parseReminderMinutes(v: unknown): ReminderMinutes[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  if (!v.every((m): m is ReminderMinutes => typeof m === "number" && VALID.has(m))) {
    return null;
  }
  return [...new Set(v)].sort((a, b) => a - b);
}

/**
 * Offsets due for a target starting at `startsAtMs` as of `nowMs`, excluding
 * those already pushed. An offset m is due iff `startsAtMs - m*60_000 <= nowMs`
 * — i.e. "due" means at-or-after its lead point, so a reminder can arrive up
 * to one 5-min sweep tick late, never early. Returns sorted ascending.
 */
export function dueOffsets(
  startsAtMs: number,
  nowMs: number,
  exclude: readonly number[],
): ReminderMinutes[] {
  return REMINDER_MINUTES.filter(
    (m) => startsAtMs - m * 60_000 <= nowMs && !exclude.includes(m),
  );
}

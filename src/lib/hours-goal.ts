export type HoursGoalProgress = { goal: number; remaining: number; pct: number };

/**
 * Pure progress calculation against the season hours goal.
 * Returns null when no goal is set (goal <= 0).
 */
export function hoursGoalProgress(hours: number, goal: number): HoursGoalProgress | null {
  if (goal <= 0) return null;
  const remaining = Math.max(0, goal - hours);
  const pct = Math.min(100, Math.max(0, Math.round((hours / goal) * 100)));
  return { goal, remaining, pct };
}

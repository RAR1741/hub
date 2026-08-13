/**
 * Minutes that local `tz` is ahead of UTC at the given UTC instant. Computed by
 * formatting the instant into `tz` wall-clock parts and differencing. PURE.
 */
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * Local wall-clock (`dateIso` = YYYY-MM-DD, `minutes` since local midnight) in
 * IANA `tz` -> UTC instant ISO string. Guesses the instant as if the wall-clock
 * were UTC, then corrects by the tz offset at that instant. One correction is
 * exact except within the DST transition hour, which the team's meeting times
 * never fall in. PURE.
 */
export function localDateTimeToInstant(dateIso: string, minutes: number, tz: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guessUtc = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offset = tzOffsetMinutes(guessUtc, tz);
  return new Date(guessUtc - offset * 60000).toISOString();
}

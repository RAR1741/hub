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

/**
 * UTC instant ISO string -> local wall-clock "YYYY-MM-DDTHH:mm" in IANA `tz`,
 * for use as a `datetime-local` input value. Exact: formatting an instant into
 * a zone is unambiguous. PURE.
 */
export function instantToDatetimeLocal(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/**
 * Inverse of `instantToDatetimeLocal`: a `datetime-local` input value
 * ("YYYY-MM-DDTHH:mm") wall-clock in IANA `tz` -> UTC instant ISO string.
 * Thin wrapper over `localDateTimeToInstant`, so it inherits that function's
 * DST-transition-hour caveat. PURE.
 */
export function datetimeLocalToInstant(value: string, tz: string): string {
  const [dateIso, time] = value.split("T");
  const [hh, mm] = time.split(":").map(Number);
  return localDateTimeToInstant(dateIso, hh * 60 + mm, tz);
}

/**
 * All-day = both instants are exactly local midnight in `tz` and the end's
 * local date is later than the start's (Google all-day events are stored this
 * way, end exclusive). Compares calendar dates, not elapsed ms, so a 23h
 * spring-forward day still counts. PURE.
 */
export function isAllDayRange(startsAt: string, endsAt: string, tz: string): boolean {
  const s = instantToDatetimeLocal(startsAt, tz);
  const e = instantToDatetimeLocal(endsAt, tz);
  return s.endsWith("T00:00") && e.endsWith("T00:00") && e.slice(0, 10) > s.slice(0, 10);
}

/**
 * Per-cell display strings for an event range: all-day -> date only, end
 * inclusive (last day, not the exclusive midnight); otherwise full date-times.
 * PURE.
 */
export function formatEventCells(
  startsAt: string,
  endsAt: string,
  tz: string,
  locale?: string,
): [string, string] {
  if (!isAllDayRange(startsAt, endsAt, tz)) {
    return [
      new Date(startsAt).toLocaleString(locale, { timeZone: tz }),
      new Date(endsAt).toLocaleString(locale, { timeZone: tz }),
    ];
  }
  // Subtract a day from end's local date in pure date arithmetic (DST-safe).
  const [y, m, d] = instantToDatetimeLocal(endsAt, tz).slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1, d - 1));
  return [
    new Date(startsAt).toLocaleDateString(locale, { timeZone: tz }),
    lastDay.toLocaleDateString(locale, { timeZone: "UTC" }),
  ];
}

/** "start – end" for an event range; all-day collapses to date(s). PURE. */
export function formatEventRange(startsAt: string, endsAt: string, tz: string, locale?: string): string {
  const [s, e] = formatEventCells(startsAt, endsAt, tz, locale);
  return isAllDayRange(startsAt, endsAt, tz) && s === e ? s : `${s} – ${e}`;
}

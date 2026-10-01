import { describe, expect, test } from "vitest";
import { datetimeLocalToInstant, formatEventRange, instantToDatetimeLocal, isAllDayRange, localDateTimeToInstant } from "./tz";

describe("localDateTimeToInstant", () => {
  // Indianapolis is UTC-5 in January (no DST). 18:30 local -> 23:30 UTC same day.
  test("converts winter wall-clock to UTC (America/Indiana/Indianapolis)", () => {
    expect(localDateTimeToInstant("2026-01-09", 18 * 60 + 30, "America/Indiana/Indianapolis"))
      .toBe("2026-01-09T23:30:00.000Z");
  });
  // 00:12 local on Jan 10 -> 05:12 UTC (used for the next-day side of an overnight session).
  test("converts a past-midnight wall-clock", () => {
    expect(localDateTimeToInstant("2026-01-10", 12, "America/Indiana/Indianapolis"))
      .toBe("2026-01-10T05:12:00.000Z");
  });
  // Sanity across a DST-observing zone in summer (UTC-4).
  test("respects DST offset", () => {
    expect(localDateTimeToInstant("2026-07-01", 12 * 60, "America/New_York"))
      .toBe("2026-07-01T16:00:00.000Z");
  });
});

describe("instantToDatetimeLocal", () => {
  // 2026-01-15T23:00:00Z is EST (UTC-5) in Indianapolis -> 18:00 local.
  test("formats a winter (EST) instant to local wall-clock", () => {
    expect(instantToDatetimeLocal("2026-01-15T23:00:00.000Z", "America/Indiana/Indianapolis"))
      .toBe("2026-01-15T18:00");
  });
  // 2026-07-15T22:00:00Z is EDT (UTC-4) in Indianapolis -> 18:00 local.
  test("formats a summer (EDT) instant to local wall-clock", () => {
    expect(instantToDatetimeLocal("2026-07-15T22:00:00.000Z", "America/Indiana/Indianapolis"))
      .toBe("2026-07-15T18:00");
  });
  test("round-trips through datetimeLocalToInstant", () => {
    const instant = "2026-01-15T23:00:00.000Z";
    const tz = "America/Indiana/Indianapolis";
    expect(datetimeLocalToInstant(instantToDatetimeLocal(instant, tz), tz)).toBe(instant);
  });
});

describe("formatEventRange", () => {
  const tz = "America/Indiana/Indianapolis";
  const range = (s: string, e: string) =>
    formatEventRange(localDateTimeToInstant(s, 0, tz), localDateTimeToInstant(e, 0, tz), tz, "en-US");

  test("single-day all-day shows one date", () => {
    expect(range("2026-10-03", "2026-10-04")).toBe("10/3/2026");
  });
  test("multi-day all-day shows inclusive range", () => {
    expect(range("2026-10-03", "2026-10-05")).toBe("10/3/2026 – 10/4/2026");
  });
  test("all-day across DST end (Nov 1 2026) is date only", () => {
    expect(range("2026-11-01", "2026-11-02")).toBe("11/1/2026");
    expect(range("2026-10-31", "2026-11-02")).toBe("10/31/2026 – 11/1/2026");
  });
  test("single-day all-day on spring-forward day (23h) is date only", () => {
    expect(range("2026-03-08", "2026-03-09")).toBe("3/8/2026");
  });
  test("zero-length midnight-to-same-midnight is not all-day", () => {
    const s = localDateTimeToInstant("2026-10-03", 0, tz);
    expect(isAllDayRange(s, s, tz)).toBe(false);
  });
  test("timed event keeps the date-time pair", () => {
    const s = localDateTimeToInstant("2026-10-03", 18 * 60, tz);
    const e = localDateTimeToInstant("2026-10-03", 20 * 60, tz);
    expect(formatEventRange(s, e, tz, "en-US")).toBe("10/3/2026, 6:00:00 PM – 10/3/2026, 8:00:00 PM");
  });
  test("midnight-to-midnight under 24h is not all-day", () => {
    const s = localDateTimeToInstant("2026-10-03", 0, tz);
    const e = localDateTimeToInstant("2026-10-03", 12 * 60, tz);
    expect(isAllDayRange(s, e, tz)).toBe(false);
  });
});

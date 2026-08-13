import { describe, expect, test } from "vitest";
import { localDateTimeToInstant } from "./tz";

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

import { describe, expect, it } from "vitest";
import { formatClockDuration } from "./format";

describe("formatClockDuration", () => {
  it("renders m:ss under a minute", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const now = since.getTime() + 5_000;
    expect(formatClockDuration(since.toISOString(), now)).toBe("0:05");
  });

  it("renders m:ss for minutes and seconds under an hour", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const now = since.getTime() + 125_000; // 2m05s
    expect(formatClockDuration(since.toISOString(), now)).toBe("2:05");
  });

  it("renders h:mm at and over an hour", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const now = since.getTime() + 3_725_000; // 1h 02m 05s
    expect(formatClockDuration(since.toISOString(), now)).toBe("1:02");
  });

  it("clamps negative elapsed time (clock skew) to zero", () => {
    const since = new Date("2026-01-01T00:00:10Z");
    const now = since.getTime() - 5_000;
    expect(formatClockDuration(since.toISOString(), now)).toBe("0:00");
  });
});

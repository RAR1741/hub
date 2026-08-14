import { describe, expect, test } from "vitest";
import {
  overlappingSessionIds,
  sessionFlags,
  sessionHours,
  totalHours,
} from "./hours";
import type { Session } from "./types";

const base: Session = {
  id: "s", personId: "p1", periodId: "pd1",
  timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z",
  source: "kiosk", note: null, excludedFromTotals: false, editedBy: null, editedAt: null,
  flagsResolvedAt: null,
};

describe("sessionHours", () => {
  test("closed session duration", () => {
    expect(sessionHours(base)).toBe(3);
  });
  test("open session measured to now", () => {
    const now = () => Date.parse("2026-09-01T19:30:00Z");
    expect(sessionHours({ timeIn: base.timeIn, timeOut: null }, now)).toBe(1.5);
  });
  test("never negative", () => {
    expect(
      sessionHours({ timeIn: "2026-09-01T21:00:00Z", timeOut: "2026-09-01T18:00:00Z" }),
    ).toBe(0);
  });
});

describe("totalHours", () => {
  test("sums closed non-excluded sessions; skips open and excluded", () => {
    const sessions: Session[] = [
      base,
      { ...base, id: "s2", timeOut: "2026-09-01T20:00:00Z" }, // 2h
      { ...base, id: "s3", excludedFromTotals: true },        // skipped
      { ...base, id: "s4", timeOut: null },                   // open → skipped
    ];
    expect(totalHours(sessions)).toBe(5);
  });
});

describe("sessionFlags", () => {
  test("still_open for an open session", () => {
    expect(sessionFlags({ ...base, timeOut: null }, 18)).toContain("still_open");
  });
  test("over_max for a session longer than maxShiftHours", () => {
    const long = { ...base, timeOut: "2026-09-02T14:00:00Z" }; // 20h
    expect(sessionFlags(long, 18)).toContain("over_max");
  });
  test("auto_closed when edited_at set but edited_by null and closed", () => {
    const swept = { ...base, editedAt: "2026-09-02T08:00:00Z", editedBy: null };
    expect(sessionFlags(swept, 18)).toContain("auto_closed");
  });
  test("a clean short session has no flags", () => {
    expect(sessionFlags(base, 18)).toEqual([]);
  });
});

describe("overlappingSessionIds", () => {
  test("flags two sessions that overlap for the same person", () => {
    const a = { ...base, id: "a", timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z" };
    const b = { ...base, id: "b", timeIn: "2026-09-01T19:00:00Z", timeOut: "2026-09-01T21:00:00Z" };
    const c = { ...base, id: "c", personId: "p2", timeIn: "2026-09-01T19:00:00Z", timeOut: "2026-09-01T21:00:00Z" };
    const ids = overlappingSessionIds([a, b, c]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(false); // different person
  });
});

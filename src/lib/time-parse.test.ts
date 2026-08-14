import { describe, expect, test } from "vitest";
import { parseClockToken, resolveColumnTimes } from "./time-parse";

describe("parseClockToken", () => {
  test("24-hour with hour > 12 is confident", () => {
    expect(parseClockToken("18:29")).toEqual({ kind: "confident", minutes: 18 * 60 + 29 });
  });
  test("explicit AM/PM (with seconds) is confident", () => {
    expect(parseClockToken("6:26:00 PM")).toEqual({ kind: "confident", minutes: 18 * 60 + 26 });
    expect(parseClockToken("9:00 AM")).toEqual({ kind: "confident", minutes: 9 * 60 });
    expect(parseClockToken("5:56:26 PM")).toEqual({ kind: "confident", minutes: 17 * 60 + 56 });
  });
  test("24-hour with seconds and midnight-hour are confident", () => {
    expect(parseClockToken("21:25:00")).toEqual({ kind: "confident", minutes: 21 * 60 + 25 });
    expect(parseClockToken("0:12")).toEqual({ kind: "confident", minutes: 12 });
  });
  test("bare h:mm with hour 1..12 is ambiguous (both interpretations)", () => {
    expect(parseClockToken("8:52")).toEqual({ kind: "ambiguous", am: 8 * 60 + 52, pm: 20 * 60 + 52 });
    expect(parseClockToken("12:30")).toEqual({ kind: "ambiguous", am: 30, pm: 12 * 60 + 30 });
  });
  test("excused (any case, trailing space) and empties", () => {
    expect(parseClockToken("Excused").kind).toBe("excused");
    expect(parseClockToken("Excused ").kind).toBe("excused");
    expect(parseClockToken("").kind).toBe("empty");
    expect(parseClockToken("   ").kind).toBe("empty");
  });
  test("garbage is unparseable", () => {
    expect(parseClockToken("OK")).toEqual({ kind: "unparseable", raw: "OK" });
  });
});

describe("resolveColumnTimes", () => {
  test("resolves ambiguous cells toward the confident median (evening column -> PM)", () => {
    const col = [
      parseClockToken("18:30"), // confident PM
      parseClockToken("18:27"), // confident PM
      parseClockToken("6:29"),  // ambiguous -> should resolve to 18:29
    ];
    const r = resolveColumnTimes(col);
    expect(r[2]).toEqual({ minutes: 18 * 60 + 29, farFromColumn: false });
  });
  test("flags a cell that is wildly off the column (e.g. 5h) but keeps its best guess", () => {
    const col = [
      parseClockToken("18:30"),
      parseClockToken("18:31"),
      parseClockToken("13:30"), // confident but 5h below the ~18:30 median
    ];
    const r = resolveColumnTimes(col);
    expect(r[2].minutes).toBe(13 * 60 + 30);
    expect(r[2].farFromColumn).toBe(true);
  });
  test("non-time cells resolve to null and are never flagged", () => {
    const r = resolveColumnTimes([parseClockToken("Excused"), parseClockToken("")]);
    expect(r).toEqual([{ minutes: null, farFromColumn: false }, { minutes: null, farFromColumn: false }]);
  });

  test("morning column with one 24h straggler: only the straggler flags, not the crowd", () => {
    // Real all-day-session shape: everyone taps in ~9am (bare = ambiguous), one
    // person's cell is 24-hour "13:22" (confident). The norm must be the 9am
    // crowd, so the lone 1:22pm entry is the outlier — not all 5 morning people.
    const col = ["8:55", "9:00", "9:02", "8:58", "9:05", "13:22"].map(parseClockToken);
    const r = resolveColumnTimes(col);
    expect(r.slice(0, 5).every((c) => c.farFromColumn === false)).toBe(true);
    expect(r[5].farFromColumn).toBe(true);
    expect(r[0].minutes).toBe(8 * 60 + 55); // morning resolved to AM, not 8:55pm
  });

  test("genuinely spread column (8h of arrivals) is not flagged — MAD widens the band", () => {
    const col = ["9:00 AM", "11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM", "7:00 PM"].map(parseClockToken);
    // Under the old fixed 4h band the 9am and 7pm ends would flag; MAD absorbs them.
    expect(resolveColumnTimes(col).every((c) => c.farFromColumn === false)).toBe(true);
  });

  test("a single-cell column never flags (MAD undefined, n=1)", () => {
    expect(resolveColumnTimes([parseClockToken("18:29")])).toEqual([
      { minutes: 18 * 60 + 29, farFromColumn: false },
    ]);
  });
});

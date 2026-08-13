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
});

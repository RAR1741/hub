// src/lib/reminder-minutes.test.ts
import { describe, expect, test } from "vitest";
import { dueOffsets, parseReminderMinutes } from "./reminder-minutes";

describe("parseReminderMinutes", () => {
  test("undefined and null mean no reminders", () => {
    expect(parseReminderMinutes(undefined)).toEqual([]);
    expect(parseReminderMinutes(null)).toEqual([]);
  });

  test("dedupes and sorts ascending", () => {
    expect(parseReminderMinutes([60, 15, 15])).toEqual([15, 60]);
  });

  test("empty array is valid (no reminders)", () => {
    expect(parseReminderMinutes([])).toEqual([]);
  });

  test("rejects an offset outside {15,30,60,120}", () => {
    expect(parseReminderMinutes([45])).toBeNull();
  });

  test("rejects non-array input", () => {
    expect(parseReminderMinutes("60")).toBeNull();
    expect(parseReminderMinutes(60)).toBeNull();
  });

  test("rejects string members even if numerically valid", () => {
    expect(parseReminderMinutes(["60"])).toBeNull();
  });
});

describe("dueOffsets", () => {
  const startsAtMs = Date.UTC(2026, 8, 10, 18, 0, 0);

  test("an offset is due exactly at its lead point (and larger, earlier offsets are already due too)", () => {
    const nowMs = startsAtMs - 15 * 60_000;
    expect(dueOffsets(startsAtMs, nowMs, [])).toEqual([15, 30, 60, 120]);
  });

  test("just before its lead point, an offset is not yet due, but larger already-due offsets still are", () => {
    const nowMs = startsAtMs - 60 * 60_000 - 1;
    expect(dueOffsets(startsAtMs, nowMs, [])).toEqual([120]);

    const nowMs2 = startsAtMs - 60 * 60_000;
    expect(dueOffsets(startsAtMs, nowMs2, [])).toEqual([60, 120]);
  });

  test("exclude removes an otherwise-due offset", () => {
    const nowMs = startsAtMs; // everything due
    expect(dueOffsets(startsAtMs, nowMs, [15])).toEqual([30, 60, 120]);
  });

  test("returns empty when every due offset is excluded", () => {
    const nowMs = startsAtMs;
    expect(dueOffsets(startsAtMs, nowMs, [15, 30, 60, 120])).toEqual([]);
  });
});

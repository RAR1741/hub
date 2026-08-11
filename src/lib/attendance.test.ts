import { describe, expect, test } from "vitest";
import {
  attendanceForDate,
  attendanceSummary,
  localDateOf,
  sessionLocalDate,
} from "./attendance";
import type { BuildDay, Excusal, Session } from "./types";

const TZ = "America/Indiana/Indianapolis"; // US Eastern; EDT (UTC-4) in September

const session = (over: Partial<Session>): Session => ({
  id: "s", personId: "p1", periodId: "pd1",
  timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z",
  source: "kiosk", note: null, excludedFromTotals: false, editedBy: null, editedAt: null,
  ...over,
});

const bd = (date: string, kind: BuildDay["kind"] = "required"): BuildDay => ({
  date, kind, source: "gcal", meetingId: null,
});

describe("localDateOf", () => {
  test("converts a UTC instant to the team-local date", () => {
    // 03:00Z on Sep 2 is 23:00 Sep 1 in EDT (UTC-4)
    expect(localDateOf("2026-09-02T03:00:00Z", TZ)).toBe("2026-09-01");
  });
  test("handles a DST-transition day (spring forward 2026-03-08)", () => {
    // 06:30Z is 01:30 EST (UTC-5), still Mar 8 locally
    expect(localDateOf("2026-03-08T06:30:00Z", TZ)).toBe("2026-03-08");
  });
});

describe("sessionLocalDate", () => {
  test("uses time_in converted through tz", () => {
    expect(sessionLocalDate({ timeIn: "2026-09-02T03:00:00Z" }, TZ)).toBe("2026-09-01");
  });
});

describe("attendanceForDate", () => {
  test("present when a session overlaps the local date", () => {
    const s = session({ timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("present");
  });
  test("a session is attributed to its sign-in day only, even when it spans local midnight", () => {
    // 03:00Z Sep 2 = 23:00 Sep 1 local; 05:00Z Sep 2 = 01:00 Sep 2 local
    const s = session({ timeIn: "2026-09-02T03:00:00Z", timeOut: "2026-09-02T05:00:00Z" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("present");
    expect(attendanceForDate("p1", "2026-09-02", "required", [s], [], TZ)).toBe("absent");
  });
  test("an excluded-from-totals session does not make the day present", () => {
    const s = session({ excludedFromTotals: true });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("absent");
  });
  test("excused when no session but an excusal row exists", () => {
    const e: Excusal = { personId: "p1", date: "2026-09-01", note: null, createdBy: "p2" };
    expect(attendanceForDate("p1", "2026-09-01", "required", [], [e], TZ)).toBe("excused");
  });
  test("optional day with no session is optional, not absent", () => {
    expect(attendanceForDate("p1", "2026-09-01", "optional", [], [], TZ)).toBe("optional");
  });
  test("absent only when required and neither present nor excused", () => {
    expect(attendanceForDate("p1", "2026-09-01", "required", [], [], TZ)).toBe("absent");
  });
  test("present beats excused (session on an excused day)", () => {
    const s = session({ timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T21:00:00Z" });
    const e: Excusal = { personId: "p1", date: "2026-09-01", note: null, createdBy: "p2" };
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [e], TZ)).toBe("present");
  });
  test("another person's session does not count", () => {
    const s = session({ personId: "p2" });
    expect(attendanceForDate("p1", "2026-09-01", "required", [s], [], TZ)).toBe("absent");
  });
});

describe("attendanceSummary", () => {
  test("excusals shrink the denominator; optional excluded; present-on-excused counts", () => {
    const buildDays: BuildDay[] = [
      bd("2026-09-01", "required"), // present
      bd("2026-09-02", "required"), // absent
      bd("2026-09-03", "required"), // excused → out of denominator
      bd("2026-09-04", "optional"), // optional → never counts
      bd("2026-09-05", "required"), // present (also excused, but present wins)
    ];
    const sessions: Session[] = [
      session({ id: "a", timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z" }),
      session({ id: "b", timeIn: "2026-09-05T18:00:00Z", timeOut: "2026-09-05T20:00:00Z" }),
    ];
    const excusals: Excusal[] = [
      { personId: "p1", date: "2026-09-03", note: null, createdBy: "p2" },
      { personId: "p1", date: "2026-09-05", note: null, createdBy: "p2" },
    ];
    const s = attendanceSummary("p1", buildDays, sessions, excusals, TZ);
    expect(s).toEqual({
      present: 2, excused: 1, optional: 1, absent: 1,
      denominator: 3,          // 2 present + 1 absent (excused day excluded)
      percentage: 66.67,       // 2 / 3
    });
  });
  test("percentage is null when the denominator is zero", () => {
    const s = attendanceSummary("p1", [bd("2026-09-01", "optional")], [], [], TZ);
    expect(s.percentage).toBeNull();
    expect(s.denominator).toBe(0);
  });
  test("an attended optional day counts as optional, not present, and never touches the denominator", () => {
    const buildDays: BuildDay[] = [
      bd("2026-09-01", "required"), // present
      bd("2026-09-02", "optional"), // attended, but must still be optional
    ];
    const sessions: Session[] = [
      session({ id: "a", timeIn: "2026-09-01T18:00:00Z", timeOut: "2026-09-01T20:00:00Z" }),
      session({ id: "b", timeIn: "2026-09-02T18:00:00Z", timeOut: "2026-09-02T20:00:00Z" }),
    ];
    const s = attendanceSummary("p1", buildDays, sessions, [], TZ);
    expect(s).toEqual({
      present: 1, excused: 0, optional: 1, absent: 0,
      denominator: 1,
      percentage: 100,
    });
  });
});

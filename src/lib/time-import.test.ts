import { describe, expect, test } from "vitest";
import { anomalyKey, parseTimeSheet } from "./time-import";

describe("anomalyKey", () => {
  test("is a stable person+date identity", () => {
    expect(anomalyKey("Ada", "Lovelace", "2026-01-08")).toBe("Ada|Lovelace|2026-01-08");
  });
});

// A compact sheet with the real quirks. Row 1 day-of-week labels; row 2 dates
// (block starts at col index 3, stride 3); row 3 sub-headers; then data.
const SHEET = [
  ",,,,,,Saturday,,,Sunday,,,,Varsity",
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Letter',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  // Ada: kickoff session (Jan 8), a morning session (Jan 10), excused (Jan 11)
  "Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,Excused,,0:00,10",
  // Bo: overnight on Jan 8 (18:00 -> 1:00 next day), missing clock-out Jan 10
  "Bo,Peep,0.00,18:00,1:00,7:00,8:52,,0:00,,,0:00,7",
  // reference + blank rows must be dropped
  ",Available Time,#N/A,,,,,,0:00,,,0:00,",
  ",,73.50,,,,,,0:00,,,0:00,",
].join("\n");

describe("parseTimeSheet", () => {
  test("detects dates from the date row (stride 3), ignoring summary columns", () => {
    expect(parseTimeSheet(SHEET).dates).toEqual(["2026-01-08", "2026-01-10", "2026-01-11"]);
  });

  test("keeps only rows with both names; drops reference/blank rows", () => {
    const people = parseTimeSheet(SHEET).people;
    expect(people.map((p) => `${p.firstName} ${p.lastName}`)).toEqual(["Ada Lovelace", "Bo Peep"]);
  });

  test("emits a session per Time-In+Time-Out pair", () => {
    const ada = parseTimeSheet(SHEET).people[0];
    expect(ada.sessions).toContainEqual({ date: "2026-01-08", timeIn: "18:29", timeOut: "20:58", timeOutDate: "2026-01-08" });
    expect(ada.sessions).toContainEqual({ date: "2026-01-10", timeIn: "09:00", timeOut: "17:04", timeOutDate: "2026-01-10" });
  });

  test("Excused cell -> excusal", () => {
    expect(parseTimeSheet(SHEET).people[0].excusals).toEqual([{ date: "2026-01-11" }]);
  });

  test("overnight Time-Out rolls to the next day, hours belong to the start day", () => {
    const bo = parseTimeSheet(SHEET).people[1];
    expect(bo.sessions).toContainEqual({ date: "2026-01-08", timeIn: "18:00", timeOut: "01:00", timeOutDate: "2026-01-09" });
  });

  test("Time-In with no Time-Out is skipped and reported", () => {
    const bo = parseTimeSheet(SHEET).people[1];
    expect(bo.skipped).toContainEqual({ date: "2026-01-10", reason: "missing clock-out" });
  });

  test("the row-aware overnight resolution is not flagged as an anomaly", () => {
    expect(parseTimeSheet(SHEET).people[1].anomalies).toEqual([]);
  });
});

// Students first, a >=3-row gap of blank/summary rows, then mentors.
const SPLIT_SHEET = [
  ",,,,,,Saturday,,,Sunday,,,,Varsity",
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Letter',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Ada,Lovelace,0.00,18:29,20:58,OK,,,0:00,,,0:00,10",
  "Bo,Peep,0.00,18:00,20:00,OK,,,0:00,,,0:00,7",
  ",,,,,,,,,,,,",             // gap row 1 (blank)
  ",Available Time,,,,,,,,,,,", // gap row 2 (summary label)
  ",,,,,,,,,,,,",             // gap row 3 (blank)
  "Cody,Mentor,0.00,18:00,21:00,OK,,,0:00,,,0:00,7",
  "Dana,Coach,0.00,18:05,21:00,OK,,,0:00,,,0:00,7",
].join("\n");

// Evening column (Eve/Fred confident ~18:2x) flips Mort's bare "8:46" to PM;
// Nora's "12:30" is noon (morning reading 00:30 is not a plausible arrival).
const UNCERTAIN_SHEET = [
  ",,,,,,Friday,,,Sunday,,,,Varsity",
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Letter',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  "Eve,Evening,0.00,18:30,21:00,OK,,,0:00,,,0:00,5",
  "Fred,Evening,0.00,18:20,21:00,OK,,,0:00,,,0:00,5",
  "Mort,Morning,0.00,8:46,21:15,OK,,,0:00,,,0:00,12",
  "Nora,Noon,0.00,12:30,17:00,OK,,,0:00,,,0:00,4",
].join("\n");

describe("am_pm_uncertain flag", () => {
  test("flags a morning-looking clock-in that consensus flipped to PM", () => {
    const mort = parseTimeSheet(UNCERTAIN_SHEET).people.find((x) => x.firstName === "Mort")!;
    expect(mort.anomalies.some((a) => a.kind === "am_pm_uncertain")).toBe(true);
    expect(mort.sessions[0].timeIn).toBe("20:46"); // surfaced, not coerced — still the consensus guess
  });
  test("does not flag noon — the 00:xx morning reading is not a plausible arrival", () => {
    const nora = parseTimeSheet(UNCERTAIN_SHEET).people.find((x) => x.firstName === "Nora")!;
    expect(nora.anomalies.some((a) => a.kind === "am_pm_uncertain")).toBe(false);
    expect(nora.sessions[0].timeIn).toBe("12:30");
  });
  test("does not flag a confident 24-hour clock-in", () => {
    const eve = parseTimeSheet(UNCERTAIN_SHEET).people.find((x) => x.firstName === "Eve")!;
    expect(eve.anomalies).toEqual([]);
  });
  test("does not flag a morning clock-in resolved to AM (unremarkable)", () => {
    // In SHEET, Ada's Jan-10 "9:00" resolves to 09:00 — morning stays morning.
    const anomalies = parseTimeSheet(SHEET).people.flatMap((p) => p.anomalies);
    expect(anomalies.some((a) => a.kind === "am_pm_uncertain")).toBe(false);
  });
});

describe("student/mentor split", () => {
  test("splits on the largest gap: pre-gap people are students, post-gap are mentors", () => {
    const p = parseTimeSheet(SPLIT_SHEET);
    expect(p.people.map((x) => `${x.firstName}:${x.roleHint}`)).toEqual([
      "Ada:student", "Bo:student", "Cody:mentor", "Dana:mentor",
    ]);
    expect(p.fileIssues).toEqual([]);
  });

  test("no clear divider (contiguous rows) -> everyone a student, with a warning", () => {
    const p = parseTimeSheet(SHEET); // Ada + Bo, no gap between them
    expect(p.people.every((x) => x.roleHint === "student")).toBe(true);
    expect(p.fileIssues.some((f) => /divider/i.test(f))).toBe(true);
  });
});

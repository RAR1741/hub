import { describe, expect, test } from "vitest";
import { personFromRow, teamFromRow, type TeamRow } from "./types";
import { periodFromRow, sessionFromRow, type PeriodRow, type SessionRow } from "./types";
import {
  buildDayFromRow, excusalFromRow, meetingFromRow,
  type BuildDayRow, type ExcusalRow, type MeetingRow,
} from "./types";

describe("teamFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: TeamRow = {
      id: "t1",
      name: "Programming",
      parent_team_id: "t0",
      description: "Software",
      join_mode: "open",
    };
    expect(teamFromRow(row)).toEqual({
      id: "t1",
      name: "Programming",
      parentTeamId: "t0",
      description: "Software",
      joinMode: "open",
    });
  });
});

describe("personFromRow detail fields", () => {
  test("maps optional detail fields, defaulting to null when absent", () => {
    const person = personFromRow({
      id: "p1",
      first_name: "Test",
      last_name: "Student",
      display_name: null,
      role: "student",
      grad_year: 2028,
      email: null,
      is_active: true,
      student_id_number: "1741",
      auth_user_id: null,
    });
    expect(person.phone).toBeNull();
    expect(person.shirtSize).toBeNull();
    expect(person.dietaryRestrictions).toBeNull();
    expect(person.bio).toBeNull();
  });
});

describe("periodFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: PeriodRow = {
      id: "pd1", name: "S", starts_on: "2026-08-01", ends_on: "2027-07-31", is_active: true,
    };
    expect(periodFromRow(row)).toEqual({
      id: "pd1", name: "S", startsOn: "2026-08-01", endsOn: "2027-07-31", isActive: true,
    });
  });
});

describe("sessionFromRow", () => {
  test("maps all fields", () => {
    const row: SessionRow = {
      id: "s1", person_id: "p1", period_id: "pd1",
      time_in: "2026-09-01T22:00:00Z", time_out: null,
      source: "kiosk", note: null, excluded_from_totals: false,
      edited_by: null, edited_at: null,
    };
    expect(sessionFromRow(row)).toEqual({
      id: "s1", personId: "p1", periodId: "pd1",
      timeIn: "2026-09-01T22:00:00Z", timeOut: null,
      source: "kiosk", note: null, excludedFromTotals: false,
      editedBy: null, editedAt: null,
    });
  });
});

describe("meetingFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: MeetingRow = {
      id: "m1", gcal_event_id: "g1", title: "Build",
      starts_at: "2026-09-01T22:00:00Z", ends_at: "2026-09-02T01:00:00Z",
      synced_at: "2026-08-31T12:00:00Z",
    };
    expect(meetingFromRow(row)).toEqual({
      id: "m1", gcalEventId: "g1", title: "Build",
      startsAt: "2026-09-01T22:00:00Z", endsAt: "2026-09-02T01:00:00Z",
      syncedAt: "2026-08-31T12:00:00Z",
    });
  });
});

describe("buildDayFromRow", () => {
  test("maps all fields", () => {
    const row: BuildDayRow = { date: "2026-09-01", kind: "optional", source: "gcal", meeting_id: "m1" };
    expect(buildDayFromRow(row)).toEqual({
      date: "2026-09-01", kind: "optional", source: "gcal", meetingId: "m1",
    });
  });
});

describe("excusalFromRow", () => {
  test("maps all fields", () => {
    const row: ExcusalRow = { person_id: "p1", date: "2026-09-01", note: "sick", created_by: "p2" };
    expect(excusalFromRow(row)).toEqual({
      personId: "p1", date: "2026-09-01", note: "sick", createdBy: "p2",
    });
  });
});

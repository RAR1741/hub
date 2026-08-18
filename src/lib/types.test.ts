import { describe, expect, test } from "vitest";
import { personFromRow, teamFromRow, type TeamRow } from "./types";
import { periodFromRow, sessionFromRow, type PeriodRow, type SessionRow } from "./types";
import {
  buildDayFromRow, excusalFromRow, meetingFromRow,
  type BuildDayRow, type ExcusalRow, type MeetingRow,
} from "./types";
import { excusalRequestFromRow, type ExcusalRequestRow } from "./types";
import {
  firstExperienceFromRow, guardianFromRow,
  type FirstExperienceRow, type GuardianRow,
} from "./types";
import { eventFromRow } from "./types";

describe("teamFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: TeamRow = {
      id: "t1",
      name: "Programming",
      parent_team_id: "t0",
      description: "Software",
      join_mode: "open",
      google_group_email: null,
    };
    expect(teamFromRow(row)).toEqual({
      id: "t1",
      name: "Programming",
      parentTeamId: "t0",
      description: "Software",
      joinMode: "open",
      googleGroupEmail: null,
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
    });
    expect(person.phone).toBeNull();
    expect(person.shirtSize).toBeNull();
    expect(person.dietaryRestrictions).toBeNull();
    expect(person.bio).toBeNull();
    expect(person.dateOfBirth).toBeNull();
    expect(person.streetAddress).toBeNull();
    expect(person.city).toBeNull();
    expect(person.zip).toBeNull();
    expect(person.homePhone).toBeNull();
    expect(person.school).toBeNull();
    expect(person.ethnicity).toBeNull();
    expect(person.race).toBeNull();
    expect(person.interests).toBeNull();
    expect(person.lastApplicationAt).toBeNull();
  });

  test("maps application-sourced fields when present", () => {
    const person = personFromRow({
      id: "p2",
      first_name: "Test",
      last_name: "Applicant",
      display_name: null,
      role: "student",
      grad_year: 2028,
      email: null,
      is_active: true,
      student_id_number: "1742",
      date_of_birth: "2010-05-01",
      street_address: "123 Main St",
      city: "Anytown",
      zip: "12345",
      home_phone: "555-1234",
      school: "Anytown High",
      ethnicity: "Not Hispanic or Latino",
      race: "White",
      interests: ["robotics", "CAD"],
      last_application_at: "2026-08-01T12:00:00Z",
    });
    expect(person.dateOfBirth).toBe("2010-05-01");
    expect(person.streetAddress).toBe("123 Main St");
    expect(person.city).toBe("Anytown");
    expect(person.zip).toBe("12345");
    expect(person.homePhone).toBe("555-1234");
    expect(person.school).toBe("Anytown High");
    expect(person.ethnicity).toBe("Not Hispanic or Latino");
    expect(person.race).toBe("White");
    expect(person.interests).toEqual(["robotics", "CAD"]);
    expect(person.lastApplicationAt).toBe("2026-08-01T12:00:00Z");
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
      edited_by: null, edited_at: null, flags_resolved_at: null,
      event_id: null,
    };
    expect(sessionFromRow(row)).toEqual({
      id: "s1", personId: "p1", periodId: "pd1",
      timeIn: "2026-09-01T22:00:00Z", timeOut: null,
      source: "kiosk", note: null, excludedFromTotals: false,
      editedBy: null, editedAt: null, flagsResolvedAt: null,
      eventId: null,
    });
  });

  test("maps event_id through", () => {
    const row: SessionRow = {
      id: "s1", person_id: "p1", period_id: "pd1",
      time_in: "2027-03-01T18:00:00Z", time_out: "2027-03-01T20:00:00Z",
      source: "event" as const, note: null, excluded_from_totals: false,
      edited_by: "m1", edited_at: "2027-01-01T00:00:00Z",
      flags_resolved_at: null, event_id: "e1",
    };
    expect(sessionFromRow(row)).toEqual({
      id: "s1", personId: "p1", periodId: "pd1",
      timeIn: "2027-03-01T18:00:00Z", timeOut: "2027-03-01T20:00:00Z",
      source: "event", note: null, excludedFromTotals: false,
      editedBy: "m1", editedAt: "2027-01-01T00:00:00Z",
      flagsResolvedAt: null, eventId: "e1",
    });
  });
});

describe("eventFromRow", () => {
  test("maps snake_case columns to camelCase", () => {
    expect(
      eventFromRow({
        id: "e1",
        period_id: "p1",
        name: "Robot Demo",
        location: "Library",
        description: null,
        starts_at: "2027-03-01T18:00:00Z",
        ends_at: "2027-03-01T20:00:00Z",
        created_by: "m1",
        created_at: "2027-01-01T00:00:00Z",
        gcal_event_id: null,
        gcal_missing: false,
      }),
    ).toEqual({
      id: "e1",
      periodId: "p1",
      name: "Robot Demo",
      location: "Library",
      description: null,
      startsAt: "2027-03-01T18:00:00Z",
      endsAt: "2027-03-01T20:00:00Z",
      createdBy: "m1",
      createdAt: "2027-01-01T00:00:00Z",
      gcalEventId: null,
      gcalMissing: false,
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

  test("maps a manual meeting's null gcal_event_id", () => {
    const row: MeetingRow = {
      id: "m2", gcal_event_id: null, title: "Off-calendar sync",
      starts_at: "2026-09-03T22:00:00Z", ends_at: "2026-09-04T01:00:00Z",
      synced_at: "2026-08-31T12:00:00Z",
    };
    expect(meetingFromRow(row).gcalEventId).toBeNull();
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

describe("excusalRequestFromRow", () => {
  test("maps snake_case to camelCase for all fields", () => {
    const row: ExcusalRequestRow = {
      id: "er1", person_id: "p1", date: "2026-09-01", reason: "sick",
      status: "pending", reviewed_by: null, reviewed_at: null,
      created_at: "2026-08-31T12:00:00Z",
    };
    expect(excusalRequestFromRow(row)).toEqual({
      id: "er1", personId: "p1", date: "2026-09-01", reason: "sick",
      status: "pending", reviewedBy: null, reviewedAt: null,
      createdAt: "2026-08-31T12:00:00Z",
    });
  });

  test("maps a reviewed (approved) request", () => {
    const row: ExcusalRequestRow = {
      id: "er2", person_id: "p1", date: "2026-09-02", reason: null,
      status: "approved", reviewed_by: "p9", reviewed_at: "2026-09-02T10:00:00Z",
      created_at: "2026-08-31T12:00:00Z",
    };
    expect(excusalRequestFromRow(row)).toEqual({
      id: "er2", personId: "p1", date: "2026-09-02", reason: null,
      status: "approved", reviewedBy: "p9", reviewedAt: "2026-09-02T10:00:00Z",
      createdAt: "2026-08-31T12:00:00Z",
    });
  });
});

describe("guardianFromRow", () => {
  test("maps all fields", () => {
    const row: GuardianRow = {
      id: "g1", first_name: "Pat", last_name: "Parent",
      email: "pat@example.com", phone: "555-9999", employer: "Acme Corp",
      last_application_at: "2026-08-01T12:00:00Z", updated_at: "2026-08-01T12:00:00Z",
    };
    expect(guardianFromRow(row)).toEqual({
      id: "g1", firstName: "Pat", lastName: "Parent",
      email: "pat@example.com", phone: "555-9999", employer: "Acme Corp",
      lastApplicationAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-01T12:00:00Z",
    });
  });

  test("maps null optional fields", () => {
    const row: GuardianRow = {
      id: "g2", first_name: "Sam", last_name: "Guardian",
      email: null, phone: null, employer: null,
      last_application_at: null, updated_at: "2026-08-01T12:00:00Z",
    };
    expect(guardianFromRow(row)).toEqual({
      id: "g2", firstName: "Sam", lastName: "Guardian",
      email: null, phone: null, employer: null,
      lastApplicationAt: null, updatedAt: "2026-08-01T12:00:00Z",
    });
  });
});

describe("firstExperienceFromRow", () => {
  test("maps all fields", () => {
    const row: FirstExperienceRow = {
      id: "fe1", person_id: "p1", level: "frc", year: 2025, name: "Reefscape",
    };
    expect(firstExperienceFromRow(row)).toEqual({
      id: "fe1", personId: "p1", level: "frc", year: 2025, name: "Reefscape",
    });
  });

  test("maps a null name", () => {
    const row: FirstExperienceRow = {
      id: "fe2", person_id: "p1", level: "fll_challenge", year: 2022, name: null,
    };
    expect(firstExperienceFromRow(row)).toEqual({
      id: "fe2", personId: "p1", level: "fll_challenge", year: 2022, name: null,
    });
  });
});

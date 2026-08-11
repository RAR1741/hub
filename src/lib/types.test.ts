import { describe, expect, test } from "vitest";
import { personFromRow, teamFromRow, type TeamRow } from "./types";

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

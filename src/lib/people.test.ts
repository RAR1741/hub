import { describe, expect, test } from "vitest";
import { canViewProfile, displayName, rosterView } from "./people";
import type { PersonRow } from "./types";
import type { Viewer } from "./viewer";

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: "p1",
  first_name: "Ada",
  last_name: "Lovelace",
  display_name: null,
  role: "student",
  grad_year: 2028,
  email: "ada@example.org",
  is_active: true,
  student_id_number: "1741",
  auth_user_id: null,
  ...over,
});

describe("rosterView", () => {
  const rows = [
    row({ id: "p1", first_name: "Ada", last_name: "Lovelace" }),
    row({ id: "p2", first_name: "Zed", last_name: "Adams", display_name: "Z" }),
    row({ id: "p3", first_name: "Gone", last_name: "Inactive", is_active: false }),
  ];

  test("guest gets alphabetized names of active people only — nothing else", () => {
    const view = rosterView("guest", rows);
    expect(view).toEqual({ kind: "names", names: ["Ada Lovelace", "Z"] });
  });

  test("student and captain also get names only", () => {
    expect(rosterView("student", rows).kind).toBe("names");
    expect(rosterView("captain", rows).kind).toBe("names");
  });

  test("mentor gets full people (active only), ordered by last name", () => {
    const view = rosterView("mentor", rows);
    expect(view.kind).toBe("full");
    if (view.kind === "full") {
      expect(view.people.map((p) => p.id)).toEqual(["p2", "p1"]); // Adams before Lovelace
      expect(view.people[1].email).toBe("ada@example.org"); // full view includes contact fields
    }
  });
});

describe("displayName", () => {
  test("prefers display_name", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: "C" })).toBe("C");
  });
  test("falls back to first + last", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: null })).toBe("A B");
  });
});

describe("canViewProfile", () => {
  const viewerWith = (role: Viewer["role"], personId: string | null): Viewer =>
    personId
      ? {
          person: {
            id: personId, firstName: "X", lastName: "Y", displayName: null,
            role: role === "guest" ? "student" : (role as never), gradYear: null,
            email: null, isActive: true, studentIdNumber: null, authUserId: null,
            phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
          },
          role,
        }
      : { person: null, role };

  test("self can view", () => {
    expect(canViewProfile(viewerWith("student", "p1"), "p1")).toBe(true);
  });
  test("other student cannot", () => {
    expect(canViewProfile(viewerWith("student", "p2"), "p1")).toBe(false);
  });
  test("mentor can view anyone", () => {
    expect(canViewProfile(viewerWith("mentor", "p9"), "p1")).toBe(true);
  });
  test("guest cannot", () => {
    expect(canViewProfile(viewerWith("guest", null), "p1")).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { decideOAuthLink } from "./oauth-link";
import type { PersonRow } from "./types";

const mentor: PersonRow = {
  id: "p5",
  first_name: "Ada",
  last_name: "Mentor",
  display_name: null,
  role: "mentor",
  grad_year: null,
  email: "ada@example.org",
  is_active: true,
  student_id_number: null,
  auth_user_id: null,
};

describe("decideOAuthLink", () => {
  test("first user ever becomes admin even with no person match", () => {
    expect(decideOAuthLink({ matchedPerson: null, adminCount: 0 })).toEqual({
      action: "bootstrap-admin",
    });
  });

  test("matching mentor person links", () => {
    expect(decideOAuthLink({ matchedPerson: mentor, adminCount: 2 })).toEqual({
      action: "link",
      personId: "p5",
    });
  });

  test("matching student person does NOT link via oauth (stays guest)", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, role: "student" },
        adminCount: 2,
      }),
    ).toEqual({ action: "guest" });
  });

  test("no match with admins present stays guest", () => {
    expect(decideOAuthLink({ matchedPerson: null, adminCount: 3 })).toEqual({
      action: "guest",
    });
  });

  test("inactive person stays guest", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, is_active: false },
        adminCount: 2,
      }),
    ).toEqual({ action: "guest" });
  });
});

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
};

const admin: PersonRow = {
  id: "a1",
  first_name: "Seed",
  last_name: "Admin",
  display_name: null,
  role: "admin",
  grad_year: null,
  email: "admin@example.org",
  is_active: true,
  student_id_number: null,
};

describe("decideOAuthLink", () => {
  test("first user ever (no admins) becomes admin even with no person match", () => {
    expect(
      decideOAuthLink({
        matchedPerson: null,
        adminCount: 0,
        linkedCount: 0,
        firstAdmin: null,
      }),
    ).toEqual({ action: "bootstrap-admin" });
  });

  test("fresh setup: admins exist but none linked yet → adopt the first admin", () => {
    expect(
      decideOAuthLink({
        matchedPerson: null,
        adminCount: 1,
        linkedCount: 0,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "adopt-admin", personId: "a1" });
  });

  test("fresh setup adopts the first admin even when the email matches a mentor", () => {
    expect(
      decideOAuthLink({
        matchedPerson: mentor,
        adminCount: 1,
        linkedCount: 0,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "adopt-admin", personId: "a1" });
  });

  test("once any account is linked, adopt no longer fires — a matching mentor links", () => {
    expect(
      decideOAuthLink({
        matchedPerson: mentor,
        adminCount: 2,
        linkedCount: 1,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "link", personId: "p5" });
  });

  test("matching student person does NOT link via oauth (stays guest)", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, role: "student" },
        adminCount: 2,
        linkedCount: 1,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "guest" });
  });

  test("no match with admins present (and someone linked) stays guest", () => {
    expect(
      decideOAuthLink({
        matchedPerson: null,
        adminCount: 3,
        linkedCount: 1,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "guest" });
  });

  test("inactive matched person stays guest", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, is_active: false },
        adminCount: 2,
        linkedCount: 1,
        firstAdmin: admin,
      }),
    ).toEqual({ action: "guest" });
  });
});

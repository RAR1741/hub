import { describe, expect, test } from "vitest";
import { resolveViewer } from "./viewer";
import type { PersonRow } from "./types";

const student: PersonRow = {
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
};

describe("resolveViewer", () => {
  test("supabase auth user resolves via auth_user_id", async () => {
    const mentorRow = { ...student, id: "p2", role: "mentor" as const, auth_user_id: "u9" };
    const viewer = await resolveViewer({
      supabaseUserId: "u9",
      studentToken: null,
      verifyToken: async () => null,
      findPersonByAuthUserId: async (id) => (id === "u9" ? mentorRow : null),
      findPersonById: async () => null,
    });
    expect(viewer.role).toBe("mentor");
    expect(viewer.person?.id).toBe("p2");
  });

  test("student token resolves via person id", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: "tok",
      verifyToken: async (t) => (t === "tok" ? { personId: "p1" } : null),
      findPersonByAuthUserId: async () => null,
      findPersonById: async (id) => (id === "p1" ? student : null),
    });
    expect(viewer.role).toBe("student");
    expect(viewer.person?.firstName).toBe("Test");
  });

  test("inactive person is treated as guest", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: "tok",
      verifyToken: async () => ({ personId: "p1" }),
      findPersonByAuthUserId: async () => null,
      findPersonById: async () => ({ ...student, is_active: false }),
    });
    expect(viewer).toEqual({ person: null, role: "guest" });
  });

  test("no session at all is guest", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: null,
      verifyToken: async () => null,
      findPersonByAuthUserId: async () => null,
      findPersonById: async () => null,
    });
    expect(viewer).toEqual({ person: null, role: "guest" });
  });
});

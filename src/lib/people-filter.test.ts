import { describe, expect, test } from "vitest";
import { filterPeople, matchesRole, matchesSearch, type PeopleRow } from "./people-filter";

const row = (over: Partial<PeopleRow>): PeopleRow => ({
  id: "p1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.org",
  role: "student",
  isActive: true,
  studentIdNumber: "1741",
  ...over,
});

describe("matchesSearch", () => {
  test("empty term matches everything", () => {
    expect(matchesSearch(row({}), "")).toBe(true);
  });

  test("matches on name, case-insensitive", () => {
    expect(matchesSearch(row({}), "ADA lovelace")).toBe(true);
  });

  test("matches on email, case-insensitive", () => {
    expect(matchesSearch(row({}), "ADA@EXAMPLE")).toBe(true);
  });

  test("matches on studentIdNumber", () => {
    expect(matchesSearch(row({}), "1741")).toBe(true);
  });

  test("no match returns false", () => {
    expect(matchesSearch(row({}), "zzz")).toBe(false);
  });

  test("null/undefined email and studentIdNumber don't throw and don't match", () => {
    const p = row({ email: null, studentIdNumber: undefined });
    expect(() => matchesSearch(p, "anything")).not.toThrow();
    expect(matchesSearch(p, "anything")).toBe(false);
  });
});

describe("matchesRole", () => {
  test("all includes everyone", () => {
    expect(matchesRole("student", "all")).toBe(true);
    expect(matchesRole("mentor", "all")).toBe(true);
    expect(matchesRole("admin", "all")).toBe(true);
  });

  test("student filter excludes mentor and admin", () => {
    expect(matchesRole("student", "student")).toBe(true);
    expect(matchesRole("mentor", "student")).toBe(false);
    expect(matchesRole("admin", "student")).toBe(false);
  });

  test("mentor filter is inclusive: mentors and admins", () => {
    expect(matchesRole("mentor", "mentor")).toBe(true);
    expect(matchesRole("admin", "mentor")).toBe(true);
    expect(matchesRole("student", "mentor")).toBe(false);
  });

  test("admin filter excludes mentor", () => {
    expect(matchesRole("admin", "admin")).toBe(true);
    expect(matchesRole("mentor", "admin")).toBe(false);
  });

  test("student does not match admin filter", () => {
    expect(matchesRole("student", "admin")).toBe(false);
  });
});

describe("filterPeople", () => {
  const people = [
    row({ id: "p1", firstName: "Ada", lastName: "Lovelace", role: "student", isActive: true }),
    row({ id: "p2", firstName: "Grace", lastName: "Hopper", role: "mentor", isActive: false }),
    row({ id: "p3", firstName: "Alan", lastName: "Turing", role: "admin", isActive: true }),
  ];

  test("includeInactive=false drops inactive rows", () => {
    const result = filterPeople(people, { search: "", role: "all", includeInactive: false });
    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  test("includeInactive=true keeps inactive rows", () => {
    const result = filterPeople(people, { search: "", role: "all", includeInactive: true });
    expect(result.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  test("role and search compose with AND", () => {
    const result = filterPeople(people, {
      search: "Turing",
      role: "mentor",
      includeInactive: true,
    });
    // "Turing" matches p3 (admin, included in mentor filter), but not p2 (Hopper).
    expect(result.map((p) => p.id)).toEqual(["p3"]);
  });

  test("role student filter returns only student rows", () => {
    const result = filterPeople(people, {
      search: "",
      role: "student",
      includeInactive: true,
    });
    expect(result.map((p) => p.id)).toEqual(["p1"]);
    expect(result.every((p) => p.role === "student")).toBe(true);
  });

  test("role admin filter returns only admin rows", () => {
    const result = filterPeople(people, {
      search: "",
      role: "admin",
      includeInactive: true,
    });
    expect(result.map((p) => p.id)).toEqual(["p3"]);
    expect(result.every((p) => p.role === "admin")).toBe(true);
  });
});

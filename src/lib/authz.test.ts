import { describe, expect, test } from "vitest";
import { ForbiddenError, hasRole, requireRole } from "./authz";

describe("hasRole", () => {
  test.each([
    ["guest", "guest", true],
    ["guest", "student", false],
    ["student", "student", true],
    ["student", "mentor", false],
    ["mentor", "student", true],
    ["mentor", "admin", false],
    ["admin", "admin", true],
    ["admin", "guest", true],
  ] as const)("%s vs required %s → %s", (actual, required, expected) => {
    expect(hasRole(actual, required)).toBe(expected);
  });
});

describe("requireRole", () => {
  test("passes silently when allowed", () => {
    expect(() => requireRole("admin", "mentor")).not.toThrow();
  });

  test("throws ForbiddenError when denied", () => {
    expect(() => requireRole("student", "mentor")).toThrow(ForbiddenError);
  });
});

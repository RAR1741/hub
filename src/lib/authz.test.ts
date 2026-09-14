import { describe, expect, test, vi } from "vitest";
import { ForbiddenError, hasRole, requirePageRole, requireRole } from "./authz";
import type { Viewer } from "./viewer";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

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

describe("requirePageRole", () => {
  const signedIn = { person: { id: "p1" }, role: "student" } as unknown as Viewer;
  const guest: Viewer = { person: null, role: "guest" };

  test("allows a viewer with the required role", () => {
    redirect.mockClear();
    requirePageRole({ ...signedIn, role: "mentor" }, "mentor");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("sends a signed-in but under-privileged viewer home, not to /login", () => {
    redirect.mockClear();
    requirePageRole(signedIn, "mentor");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  test("sends an anonymous viewer to /login", () => {
    redirect.mockClear();
    requirePageRole(guest, "student");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

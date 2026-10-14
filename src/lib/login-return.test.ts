import { describe, expect, test } from "vitest";
import { loginHref, safeNext } from "./login-return";

describe("safeNext", () => {
  test.each([
    ["/teams", "/teams"],
    ["/events/abc", "/events/abc"],
    ["/events/abc?tab=x", "/events/abc?tab=x"],
    ["/x#frag", "/x"],
  ])("passes %j through as %j", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  test.each([
    undefined,
    null,
    "",
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/login",
    "/login?next=/x",
    "/api/auth/logout",
    "/auth/callback",
    " /x",
    "/api",
    "/auth",
    "/login/x",
    "/.//evil.com",
    "/..//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "/%2E%2E//evil.com",
  ])("rejects %j", (raw) => {
    expect(safeNext(raw)).toBe("/");
  });

  test.each([
    ["/authors", "/authors"],
    ["/loginx", "/loginx"],
  ])("allows lookalike %j", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  test("never returns CR/LF", () => {
    expect(safeNext("/x\r\nSet-Cookie:")).not.toMatch(/[\r\n]/);
  });

  test("tab inside the path never yields a protocol-relative result", () => {
    expect(safeNext("/\t/evil.com").startsWith("//")).toBe(false);
  });
});

describe("loginHref", () => {
  test("root has no next", () => expect(loginHref("/")).toBe("/login"));
  test("encodes next", () =>
    expect(loginHref("/events/1")).toBe("/login?next=%2Fevents%2F1"));
});

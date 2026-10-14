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
  ])("rejects %j", (raw) => {
    expect(safeNext(raw)).toBe("/");
  });

  test("never returns CR/LF", () => {
    expect(safeNext("/x\r\nSet-Cookie:")).not.toMatch(/[\r\n]/);
  });
});

describe("loginHref", () => {
  test("root has no next", () => expect(loginHref("/")).toBe("/login"));
  test("encodes next", () =>
    expect(loginHref("/events/1")).toBe("/login?next=%2Fevents%2F1"));
});

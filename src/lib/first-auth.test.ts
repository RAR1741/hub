import { describe, it, expect } from "vitest";
import { normalizeCookieHeader } from "./first-auth";

describe("normalizeCookieHeader", () => {
  it("strips a leading Cookie: label and trims", () => {
    expect(normalizeCookieHeader("Cookie: a=1; b=2")).toBe("a=1; b=2");
    expect(normalizeCookieHeader("  cookie:  a=1; b=2  ")).toBe("a=1; b=2");
  });
  it("collapses embedded newlines/whitespace to single spaces", () => {
    expect(normalizeCookieHeader("a=1;\n  b=2")).toBe("a=1; b=2");
  });
  it("leaves a plain header unchanged", () => {
    expect(normalizeCookieHeader("a=1; b=2")).toBe("a=1; b=2");
  });
});

import { describe, it, expect } from "vitest";
import { normalizeCookieHeader, mergeSetCookies, fetchWithSession } from "./first-auth";

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

describe("mergeSetCookies", () => {
  it("rotates an existing cookie's value", () => {
    expect(mergeSetCookies("a=1; .ASPXAUTH=old", [".ASPXAUTH=new; path=/; HttpOnly"])).toBe(
      "a=1; .ASPXAUTH=new",
    );
  });

  it("adds a brand-new cookie name at the end", () => {
    expect(mergeSetCookies("a=1; b=2", ["c=3; path=/"])).toBe("a=1; b=2; c=3");
  });

  it("deletes a cookie on empty value", () => {
    expect(mergeSetCookies("a=1; b=2", ["b=; path=/"])).toBe("a=1");
  });

  it("deletes a cookie on Max-Age=0", () => {
    expect(mergeSetCookies("a=1; b=2", ["b=stillhere; Max-Age=0; path=/"])).toBe("a=1");
  });

  it("leaves the header unchanged when setCookies is empty", () => {
    expect(mergeSetCookies("a=1; b=2", [])).toBe("a=1; b=2");
  });

  it("skips a malformed Set-Cookie without throwing", () => {
    expect(() => mergeSetCookies("a=1; b=2", ["nonsense-no-equals"])).not.toThrow();
    expect(mergeSetCookies("a=1; b=2", ["nonsense-no-equals"])).toBe("a=1; b=2");
  });

  it("preserves order and other cookies across multiple updates", () => {
    const result = mergeSetCookies("a=1; b=2; c=3", [
      "b=2new; path=/",
      "d=4; path=/",
      "c=; path=/",
    ]);
    expect(result).toBe("a=1; b=2new; d=4");
  });
});

describe("fetchWithSession", () => {
  it("returns the merged cookie on a 200 response with rotated Set-Cookie headers", async () => {
    const headers = new Headers();
    headers.set("set-cookie", ".ASPXAUTH=rotated; path=/; HttpOnly");
    const fakeFetch = (async () =>
      new Response("ok body", { status: 200, headers })) as unknown as typeof fetch;

    const result = await fetchWithSession(
      "https://my.firstinspires.org/Dashboard/",
      ".ASPXAUTH=old; other=kept",
      fakeFetch,
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.body).toBe("ok body");
      expect(result.cookie).toBe(".ASPXAUTH=rotated; other=kept");
    }
  });

  it("still detects auth expiry on a redirect to login", async () => {
    const headers = new Headers();
    headers.set("location", "https://firstcommunity.firstinspires.org/login");
    const fakeFetch = (async () =>
      new Response(null, { status: 302, headers })) as unknown as typeof fetch;

    const result = await fetchWithSession(
      "https://my.firstinspires.org/Dashboard/",
      ".ASPXAUTH=old",
      fakeFetch,
    );

    expect(result).toEqual({ kind: "auth" });
  });
});

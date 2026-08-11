import { describe, expect, test } from "vitest";
import { kioskTokenFromRequest } from "./kiosk-request";

describe("kioskTokenFromRequest", () => {
  test("extracts the kiosk cookie value", () => {
    const req = new Request("http://test/", {
      headers: { cookie: "other=1; hub_kiosk_token=abc.def; x=2" },
    });
    expect(kioskTokenFromRequest(req)).toBe("abc.def");
  });
  test("undefined when absent", () => {
    expect(kioskTokenFromRequest(new Request("http://test/"))).toBeUndefined();
  });
  test("keeps '=' inside the cookie value", () => {
    const req = new Request("http://test/", {
      headers: { cookie: "hub_kiosk_token=aGVsbG8=; other=1" },
    });
    expect(kioskTokenFromRequest(req)).toBe("aGVsbG8=");
  });
});

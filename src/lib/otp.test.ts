import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  evaluateOtpVerify,
  formatOtpCode,
  generateOtpCode,
  hashOtpCode,
  normalizeOtpCode,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
} from "./otp";

describe("generateOtpCode", () => {
  test("returns 8 digits, leading zeros allowed", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{8}$/);
    }
  });
});

describe("formatOtpCode", () => {
  test("inserts a dash in the middle", () => {
    expect(formatOtpCode("12345678")).toBe("1234-5678");
  });
});

describe("normalizeOtpCode", () => {
  test("strips non-digits", () => {
    expect(normalizeOtpCode("1234-5678")).toBe("12345678");
  });

  test("strips whitespace", () => {
    expect(normalizeOtpCode(" 1234 5678 ")).toBe("12345678");
  });

  test("rejects too few digits", () => {
    expect(normalizeOtpCode("1234567")).toBeNull();
  });

  test("rejects too many digits", () => {
    expect(normalizeOtpCode("123456789")).toBeNull();
  });

  test("rejects non-numeric input", () => {
    expect(normalizeOtpCode("abcdefgh")).toBeNull();
  });
});

describe("hashOtpCode", () => {
  test("matches sha256 hex", () => {
    expect(hashOtpCode("12345678")).toBe(
      createHash("sha256").update("12345678").digest("hex"),
    );
  });

  test("is deterministic", () => {
    expect(hashOtpCode("12345678")).toBe(hashOtpCode("12345678"));
  });

  test("differs for different codes", () => {
    expect(hashOtpCode("12345678")).not.toBe(hashOtpCode("87654321"));
  });
});

describe("constants", () => {
  test("ttl and max attempts", () => {
    expect(OTP_TTL_MINUTES).toBe(10);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});

describe("evaluateOtpVerify", () => {
  const hash = hashOtpCode("12345678");

  test("match when hashes are equal and under the attempt cap", () => {
    expect(evaluateOtpVerify({ code_hash: hash, attempts: 1 }, hash)).toBe("match");
  });

  test("mismatch when hashes differ", () => {
    expect(
      evaluateOtpVerify({ code_hash: hash, attempts: 1 }, hashOtpCode("00000000")),
    ).toBe("mismatch");
  });

  test("blocked once attempts reach the cap, even with the right code", () => {
    expect(
      evaluateOtpVerify({ code_hash: hash, attempts: OTP_MAX_ATTEMPTS }, hash),
    ).toBe("blocked");
  });
});

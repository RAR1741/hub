import { createHash, randomInt } from "node:crypto";
import { secureEqual } from "./secure-compare";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export function formatOtpCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeOtpCode(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type OtpVerifyDecision = "blocked" | "match" | "mismatch";

/**
 * Pure verify decision given an already-fetched, unexpired, unconsumed
 * login_otp row and the hash of the code the caller supplied. Caller is
 * responsible for the expiry/consumed lookup and for incrementing
 * row.attempts in the DB before comparing (so aborted guesses still count).
 */
export function evaluateOtpVerify(
  row: { code_hash: string; attempts: number },
  suppliedHash: string,
): OtpVerifyDecision {
  if (row.attempts >= OTP_MAX_ATTEMPTS) return "blocked";
  return secureEqual(row.code_hash, suppliedHash) ? "match" : "mismatch";
}

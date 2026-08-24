import { createHash, randomInt } from "node:crypto";

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

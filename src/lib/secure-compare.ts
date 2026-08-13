import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string equality. Hashes both inputs to fixed-length SHA-256
 * digests before `timingSafeEqual`, so the comparison neither short-circuits on
 * the first differing byte nor leaks the secret's length via input length.
 * Use for comparing a caller-supplied token against a server-held secret.
 */
export function secureEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

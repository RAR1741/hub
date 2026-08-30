import { describe, expect, test } from "vitest";
import { createHmac } from "node:crypto";
import { mintRealtimeToken } from "./realtime-token";

const SECRET = "test-secret-at-least-32-characters-long";

function decodeClaims(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split(".");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString());
}

describe("mintRealtimeToken", () => {
  test("payload has role authenticated, the hub-realtime issuer, and a future exp", () => {
    const now = () => 1_700_000_000_000;
    const { token, expiresAt } = mintRealtimeToken(SECRET, now);
    expect(token.split(".")).toHaveLength(3);
    const claims = decodeClaims(token);
    const iat = Math.floor(now() / 1000);
    expect(claims).toMatchObject({ role: "authenticated", iss: "hub-realtime", iat, exp: iat + 3600 });
    expect(expiresAt).toBe((iat + 3600) * 1000);
  });

  test("signature verifies against the known secret", () => {
    const { token } = mintRealtimeToken(SECRET, () => 1_700_000_000_000);
    const [headerB64, payloadB64, signature] = token.split(".");
    const expected = createHmac("sha256", SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    expect(signature).toBe(expected);
  });
});

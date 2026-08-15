import { describe, expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildServiceAccountJwt, fetchGoogleAccessToken, type GoogleSaCreds } from "./google-auth";

// A throwaway RSA key so buildServiceAccountJwt can actually sign in the test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDS: GoogleSaCreds = {
  clientEmail: "svc@proj.iam.gserviceaccount.com",
  privateKey: PEM,
};

function decodeClaims(jwt: string): Record<string, unknown> {
  const [, claimsB64] = jwt.split(".");
  return JSON.parse(Buffer.from(claimsB64, "base64url").toString());
}

describe("buildServiceAccountJwt", () => {
  test("produces a three-segment JWT whose claims match iss/scope/aud/iat/exp", () => {
    const now = () => 1_700_000_000_000;
    const jwt = buildServiceAccountJwt(CREDS, { scope: "https://example.com/scope" }, now);
    expect(jwt.split(".")).toHaveLength(3);
    const claims = decodeClaims(jwt);
    const iat = Math.floor(now() / 1000);
    expect(claims).toMatchObject({
      iss: CREDS.clientEmail,
      scope: "https://example.com/scope",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    });
  });

  test("omits sub when no subject is provided", () => {
    const jwt = buildServiceAccountJwt(CREDS, { scope: "scope-a" }, () => 1_700_000_000_000);
    const claims = decodeClaims(jwt);
    expect(claims.sub).toBeUndefined();
    expect("sub" in claims).toBe(false);
  });

  test("includes sub when a subject is provided (domain-wide delegation impersonation)", () => {
    const jwt = buildServiceAccountJwt(
      CREDS,
      { scope: "scope-a", subject: "user@example.com" },
      () => 1_700_000_000_000,
    );
    const claims = decodeClaims(jwt);
    expect(claims.sub).toBe("user@example.com");
  });
});

describe("fetchGoogleAccessToken", () => {
  test("posts a jwt-bearer grant to the token endpoint and returns the access token", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    let capturedHeaders: HeadersInit | undefined;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ access_token: "fake-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const token = await fetchGoogleAccessToken(
      fetchFn,
      CREDS,
      { scope: "https://example.com/scope" },
      () => 1_700_000_000_000,
    );

    expect(token).toBe("fake-token");
    expect(capturedUrl).toBe("https://oauth2.googleapis.com/token");
    expect(capturedHeaders).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(params.get("assertion")?.split(".")).toHaveLength(3);
  });

  test("throws on a non-OK response", async () => {
    const fetchFn = (async () => new Response("nope", { status: 403 })) as typeof globalThis.fetch;
    await expect(
      fetchGoogleAccessToken(fetchFn, CREDS, { scope: "scope-a" }),
    ).rejects.toThrow(/403/);
  });

  test("throws when the response has no access_token", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof globalThis.fetch;
    await expect(
      fetchGoogleAccessToken(fetchFn, CREDS, { scope: "scope-a" }),
    ).rejects.toThrow(/access_token/);
  });
});

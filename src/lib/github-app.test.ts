import { describe, expect, test, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  buildGithubAppJwt,
  fetchInstallationToken,
  githubAppConfigPresence,
  githubAppCredentialsFromEnv,
  githubHeaders,
  type GithubAppCredentials,
  type GithubDeps,
} from "./github-app";

// A throwaway RSA key so buildGithubAppJwt can actually sign in the test.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const CREDS: GithubAppCredentials = {
  appId: "12345",
  privateKey: PEM,
  installationId: "999",
  org: "RAR1741",
  clientId: "client-id",
  clientSecret: "client-secret",
};

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString());
}

describe("buildGithubAppJwt", () => {
  test("header alg RS256 and claims iat=now-60, exp=now+540, iss=appId", () => {
    const now = new Date(1_700_000_000_000);
    const jwt = buildGithubAppJwt(CREDS, now);
    const [headerB64, claimsB64] = jwt.split(".");
    expect(jwt.split(".")).toHaveLength(3);
    expect(decodeSegment(headerB64)).toEqual({ alg: "RS256", typ: "JWT" });
    const nowSec = Math.floor(now.getTime() / 1000);
    expect(decodeSegment(claimsB64)).toEqual({
      iat: nowSec - 60,
      exp: nowSec + 540,
      iss: CREDS.appId,
    });
  });

  test("signature verifies against the public key", () => {
    const now = new Date(1_700_000_000_000);
    const jwt = buildGithubAppJwt(CREDS, now);
    const [header, claims, sigB64] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    const ok = verifier.verify(PUBLIC_PEM, Buffer.from(sigB64, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("fetchInstallationToken", () => {
  test("fetches once per deps object, even when called twice", async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ token: "installation-token" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const deps: GithubDeps = {
      fetch: fetchFn as unknown as typeof fetch,
      credentials: CREDS,
      now: () => new Date(1_700_000_000_000),
    };

    const [a, b] = await Promise.all([fetchInstallationToken(deps), fetchInstallationToken(deps)]);
    expect(a).toBe("installation-token");
    expect(b).toBe("installation-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.github.com/app/installations/${CREDS.installationId}/access_tokens`,
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: expect.stringMatching(/^Bearer /),
    });
  });
});

describe("githubHeaders", () => {
  test("includes the standard GitHub REST headers plus the bearer token", () => {
    expect(githubHeaders("tok")).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rar1741-hub",
      Authorization: "Bearer tok",
    });
  });
});

describe("githubAppCredentialsFromEnv", () => {
  const ENV_KEYS = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_ORG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
  ] as const;

  function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.GITHUB_APP_ID = overrides.GITHUB_APP_ID ?? "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = overrides.GITHUB_APP_PRIVATE_KEY ?? "line1\\nline2";
    process.env.GITHUB_APP_INSTALLATION_ID = overrides.GITHUB_APP_INSTALLATION_ID ?? "999";
    process.env.GITHUB_ORG = overrides.GITHUB_ORG ?? "RAR1741";
    process.env.GITHUB_APP_CLIENT_ID = overrides.GITHUB_APP_CLIENT_ID ?? "client-id";
    process.env.GITHUB_APP_CLIENT_SECRET = overrides.GITHUB_APP_CLIENT_SECRET ?? "client-secret";
  }

  test("returns credentials and restores \\n to real newlines in the private key", () => {
    setEnv();
    const creds = githubAppCredentialsFromEnv();
    expect(creds).toEqual({
      appId: "12345",
      privateKey: "line1\nline2",
      installationId: "999",
      org: "RAR1741",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  test("returns null when any var is missing", () => {
    setEnv();
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    expect(githubAppCredentialsFromEnv()).toBeNull();
  });
});

describe("githubAppConfigPresence", () => {
  test("reports presence booleans without exposing values", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = "x";
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    process.env.GITHUB_ORG = "RAR1741";
    process.env.GITHUB_APP_CLIENT_ID = "x";
    delete process.env.GITHUB_APP_CLIENT_SECRET;

    expect(githubAppConfigPresence()).toEqual({
      appId: false,
      privateKey: true,
      installationId: false,
      org: true,
      clientId: true,
      clientSecret: false,
    });
  });
});

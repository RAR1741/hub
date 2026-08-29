import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { mintRealtimeToken } from "./route";

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

// The authz gate (kiosk cookie / viewer / 401) and the 503-on-missing-secret
// path live in the GET handler, which pulls in next/headers + the DB-backed
// kiosk/viewer lookups. Mock those modules to exercise it without a real request.
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/lib/kiosk", () => ({
  KIOSK_COOKIE: "hub_kiosk_token",
  verifyKioskToken: vi.fn(),
}));
vi.mock("@/lib/viewer", () => ({
  getViewer: vi.fn(),
}));

describe("GET /api/realtime-token", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("401 when neither a registered kiosk nor a logged-in viewer", async () => {
    const { cookies } = await import("next/headers");
    const { verifyKioskToken } = await import("@/lib/kiosk");
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(verifyKioskToken).mockResolvedValue(false);
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "guest" });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("503 when SUPABASE_JWT_SECRET is missing, even for an authorized viewer", async () => {
    const { cookies } = await import("next/headers");
    const { verifyKioskToken } = await import("@/lib/kiosk");
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(verifyKioskToken).mockResolvedValue(false);
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "mentor" });
    vi.stubEnv("SUPABASE_JWT_SECRET", "");

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
  });

  test("200 with a token for a registered kiosk", async () => {
    const { cookies } = await import("next/headers");
    const { verifyKioskToken } = await import("@/lib/kiosk");
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "kiosk-token" }) } as never);
    vi.mocked(verifyKioskToken).mockResolvedValue(true);
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "guest" });
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });
});

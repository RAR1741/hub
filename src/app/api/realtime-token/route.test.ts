import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-secret-at-least-32-characters-long";

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

  test("401 (fails closed) for a non-guest viewer with no person, rather than an unattributable token", async () => {
    const { cookies } = await import("next/headers");
    const { verifyKioskToken } = await import("@/lib/kiosk");
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(verifyKioskToken).mockResolvedValue(false);
    vi.mocked(getViewer).mockResolvedValue({ person: null, role: "mentor" } as never);
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);

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
    vi.mocked(getViewer).mockResolvedValue({ person: { id: "p-1" }, role: "mentor" } as never);
    vi.stubEnv("SUPABASE_JWT_SECRET", "");

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
  });

  test("200 with a kiosk-subject token for a registered kiosk", async () => {
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
    expect(subOf(body.token)).toBe("kiosk");
  });

  test("200 with a person-scoped subject for a logged-in viewer", async () => {
    const { cookies } = await import("next/headers");
    const { verifyKioskToken } = await import("@/lib/kiosk");
    const { getViewer } = await import("@/lib/viewer");
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    vi.mocked(verifyKioskToken).mockResolvedValue(false);
    vi.mocked(getViewer).mockResolvedValue({
      person: { id: "p-123" },
      role: "student",
    } as never);
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(subOf(body.token)).toBe("person:p-123");
  });
});

function subOf(jwt: string): unknown {
  const [, payloadB64] = jwt.split(".");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString()).sub;
}

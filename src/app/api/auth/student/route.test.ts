import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The route statically imports @/lib/db, which pulls in "server-only" (not
// importable in the test environment). We never reach the DB on the disabled
// path, so a lightweight mock lets us import the handler.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function studentLoginRequest() {
  return new Request("http://localhost/api/auth/student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: "1741" }),
  });
}

describe("POST /api/auth/student", () => {
  test("is disabled in production (single-factor, low-entropy credential)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getDb } = await import("@/lib/db");
    const { POST } = await import("./route");

    const res = await POST(studentLoginRequest());

    expect(res.status).toBe(404);
    // No session cookie is issued, and the DB is never touched, when disabled.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });
});

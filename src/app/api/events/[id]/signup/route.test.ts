import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Representative coverage that the masquerade read-only guard is wired into a
// getViewer()-based mutating handler (defense-in-depth behind the proxy
// middleware, security audit #251 item 4). Mock the DB-backed modules so the
// handler imports without pulling in "server-only"; the guard returns before
// any of them are called.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/event-signups", () => ({ signUpForEvent: vi.fn(), cancelEventSignup: vi.fn() }));
vi.mock("@/lib/events", () => ({ getEvent: vi.fn() }));
vi.mock("@/lib/form-responses", () => ({ submitEventSignupResponse: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.resetModules());

const masqueradingViewer = {
  person: { id: "target-1" },
  role: "student",
  masquerade: { adminPersonId: "admin-1", targetPersonId: "target-1", sessionId: "s1" },
};

const ctx = { params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }) };

describe("events signup masquerade guard", () => {
  test("POST is blocked with 403 masquerade_read_only while masquerading", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { getEvent } = await import("@/lib/events");
    const { signUpForEvent } = await import("@/lib/event-signups");
    vi.mocked(getViewer).mockResolvedValue(masqueradingViewer as never);

    const { POST } = await import("./route");
    const res = await POST(new Request("http://test/api/events/x/signup", { method: "POST" }), ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "masquerade_read_only" });
    // The guard fires before any event lookup or mutation.
    expect(getEvent).not.toHaveBeenCalled();
    expect(signUpForEvent).not.toHaveBeenCalled();
  });

  test("DELETE is blocked with 403 masquerade_read_only while masquerading", async () => {
    const { getViewer } = await import("@/lib/viewer");
    const { cancelEventSignup } = await import("@/lib/event-signups");
    vi.mocked(getViewer).mockResolvedValue(masqueradingViewer as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://test/api/events/x/signup", { method: "DELETE" }), ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "masquerade_read_only" });
    expect(cancelEventSignup).not.toHaveBeenCalled();
  });
});

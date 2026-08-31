import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-event-channels-secret";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));
vi.mock("@/lib/slack-channels", () => ({
  sweepEventChannels: vi.fn(),
}));

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/slack/event-channels", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/slack/event-channels", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.resetModules();
  });

  test("403 when the secret header is missing", async () => {
    const { getSetting } = await import("@/lib/settings");
    vi.mocked(getSetting).mockResolvedValue(SECRET);

    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(403);
  });

  test("403 when the provided secret is wrong", async () => {
    const { getSetting } = await import("@/lib/settings");
    vi.mocked(getSetting).mockResolvedValue(SECRET);

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": "wrong-secret" }));
    expect(res.status).toBe(403);
  });

  test("403 when the configured secret is empty (fails closed)", async () => {
    const { getSetting } = await import("@/lib/settings");
    vi.mocked(getSetting).mockResolvedValue("");

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(403);
  });

  test("200 invokes sweepEventChannels and returns its summary", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sweepEventChannels } = await import("@/lib/slack-channels");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    const summary = { archived: 1, renamed: 2, invited: 3, failed: 0 };
    vi.mocked(sweepEventChannels).mockResolvedValue(summary);

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(sweepEventChannels).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({ ok: true, ...summary });
  });
});

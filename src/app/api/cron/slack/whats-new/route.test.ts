import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-whats-new-secret";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));
vi.mock("@/lib/whats-new", () => ({
  sendWhatsNewDigest: vi.fn(),
}));
vi.mock("@/lib/system-health", () => ({
  reportSubsystemHealth: vi.fn(),
}));

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/slack/whats-new", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/slack/whats-new", () => {
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

  test("200 invokes sendWhatsNewDigest and returns its result", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sendWhatsNewDigest } = await import("@/lib/whats-new");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(sendWhatsNewDigest).mockResolvedValue({ posted: true, count: 3, clipped: false });

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(sendWhatsNewDigest).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({ posted: true, count: 3, clipped: false });
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    expect(reportSubsystemHealth).toHaveBeenCalledWith("slack_whats_new", true, expect.anything());
  });

  test("an empty window is healthy, but a formatted digest that did not post is not", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sendWhatsNewDigest } = await import("@/lib/whats-new");
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    vi.mocked(getSetting).mockResolvedValue(SECRET);

    vi.mocked(sendWhatsNewDigest).mockResolvedValue({ posted: false, count: 0, clipped: false });
    const { POST } = await import("./route");
    await POST(req({ "x-sync-secret": SECRET }));
    expect(reportSubsystemHealth).toHaveBeenLastCalledWith("slack_whats_new", true, expect.anything());

    vi.mocked(sendWhatsNewDigest).mockResolvedValue({ posted: false, count: 4, clipped: false });
    await POST(req({ "x-sync-secret": SECRET }));
    expect(reportSubsystemHealth).toHaveBeenLastCalledWith("slack_whats_new", false, expect.anything());
  });

  test("502 when sendWhatsNewDigest rejects", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sendWhatsNewDigest } = await import("@/lib/whats-new");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(sendWhatsNewDigest).mockRejectedValue(new Error("boom"));

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "failed" });
  });
});

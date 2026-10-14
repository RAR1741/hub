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
vi.mock("@/lib/slack", () => ({
  slackDepsFromEnv: vi.fn(() => ({})),
  postChannelMessage: vi.fn(async () => true),
}));
vi.mock("@/lib/system-health", () => ({
  reportSubsystemHealth: vi.fn(),
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
    const summary = { archived: 1, renamed: 2, invited: 3, failed: 0, failures: [] };
    vi.mocked(sweepEventChannels).mockResolvedValue(summary);

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(sweepEventChannels).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({ ok: true, ...summary });
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    expect(reportSubsystemHealth).toHaveBeenCalledWith("slack_event_channels", true, expect.anything());
  });

  test("200 but reports failing when the sweep had failures", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sweepEventChannels } = await import("@/lib/slack-channels");
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(sweepEventChannels).mockResolvedValue({ archived: 0, renamed: 0, invited: 0, failed: 2, failures: [] });

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(reportSubsystemHealth).toHaveBeenCalledWith("slack_event_channels", false, expect.anything());
  });

  test("failure detail names the event, channel and error, with a manual-archive hint for restricted_action", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { sweepEventChannels } = await import("@/lib/slack-channels");
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(sweepEventChannels).mockResolvedValue({
      archived: 0,
      renamed: 0,
      invited: 0,
      failed: 5,
      failures: [
        { event: "Tinker Fest", channel: "e-tinker-fest-de23", op: "archive", error: "restricted_action" },
        { event: "Other", channel: "e-other", op: "archive", error: "join:missing_scope" },
        { event: "Third", channel: null, op: "rename" },
        { event: "Fourth", channel: "e-fourth", op: "invite", error: "not_in_channel" },
        { event: "Fifth", channel: "e-fifth", op: "invite", error: "not_in_channel" },
      ],
    });

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect((await res.json()).failures).toHaveLength(5);
    const { postChannelMessage } = await import("@/lib/slack");
    expect(postChannelMessage).toHaveBeenCalledTimes(5);
    expect(vi.mocked(postChannelMessage).mock.calls[0][1]).toBe("hub-admin-alerts");
    expect(vi.mocked(postChannelMessage).mock.calls[0][2]).toContain("Tinker Fest (#e-tinker-fest-de23): archive failed — restricted_action (archive it manually");
    const detail = vi.mocked(reportSubsystemHealth).mock.calls[0][2].detail as string;
    expect(detail).toContain("Tinker Fest (#e-tinker-fest-de23): archive failed — restricted_action (archive it manually in Slack; the next sweep will record it)");
    expect(detail).toContain("Other (#e-other): archive failed — join:missing_scope");
    expect(detail).not.toContain("Other (#e-other): archive failed — join:missing_scope (archive");
    expect(detail).toContain("Third (#unknown): rename failed");
    expect(detail).not.toContain("Fourth");
    expect(detail).toContain("+2 more");
  });
});

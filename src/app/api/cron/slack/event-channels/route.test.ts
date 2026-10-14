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
vi.mock("@/lib/cron-heartbeat", () => ({ recordCronHeartbeat: vi.fn() }));
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

  async function runWith(failures: unknown[]) {
    vi.useFakeTimers();
    const { getSetting } = await import("@/lib/settings");
    const { sweepEventChannels } = await import("@/lib/slack-channels");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(sweepEventChannels).mockResolvedValue({ archived: 0, renamed: 0, invited: 0, failed: failures.length, failures } as never);
    const { POST } = await import("./route");
    const pending = POST(req({ "x-sync-secret": SECRET }));
    await vi.runAllTimersAsync();
    const res = await pending;
    const { postChannelMessage } = await import("@/lib/slack");
    const { reportSubsystemHealth } = await import("@/lib/system-health");
    const { recordCronHeartbeat } = await import("@/lib/cron-heartbeat");
    return { res, posts: vi.mocked(postChannelMessage).mock.calls.map((c) => c[2]), report: vi.mocked(reportSubsystemHealth), heartbeat: vi.mocked(recordCronHeartbeat) };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  test("failure detail names event, channel, error; restricted_action gets the manual-archive hint; detail is capped", async () => {
    const { res, posts, report } = await runWith([
      { event: "Tinker Fest", channel: "e-tinker-fest-de23", op: "archive", error: "restricted_action" },
      { event: "Other", channel: "e-other", op: "archive", error: "join:missing_scope" },
      { event: "Third", channel: null, op: "rename" },
      { event: "Fourth", channel: "e-fourth", op: "invite", error: "not_in_channel" },
      { event: "Fifth", channel: "e-fifth", op: "invite", error: "not_in_channel" },
    ]);
    expect((await res.json()).failures).toHaveLength(5);
    const detail = report.mock.calls[0][2].detail as string;
    expect(detail).toContain("Tinker Fest (#e-tinker-fest-de23): archive failed — restricted_action (archive it manually in Slack");
    expect(detail).toContain("Other (#e-other): archive failed — join:missing_scope;");
    expect(detail).toContain("Third (#unknown): rename failed");
    expect(detail).not.toContain("Fourth");
    expect(detail).toContain("+2 more");
    expect(posts).toHaveLength(5);
    expect(posts[0]).toContain(":warning: Event channel sweep: Tinker Fest (#e-tinker-fest-de23): archive failed — restricted_action (archive it manually");
  });

  test("many identical invite failures for one channel -> one post and one detail entry", async () => {
    const f = { event: "Kickoff", channel: "e-kickoff", op: "invite", error: "not_in_channel" };
    const { posts, report } = await runWith(Array.from({ length: 30 }, () => f));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("Kickoff (#e-kickoff): invite failed — not_in_channel");
    expect(report.mock.calls[0][2].detail).not.toContain("more");
  });

  test("escapes Slack mrkdwn control characters and truncates long event names", async () => {
    const { posts } = await runWith([
      { event: "<!channel> Build & day", channel: "e-x", op: "archive", error: "restricted_action" },
      { event: "L".repeat(100), channel: "e-long", op: "rename" },
    ]);
    expect(posts[0]).toContain("&lt;!channel&gt; Build &amp; day (#e-x)");
    expect(posts[0]).not.toContain("<!channel>");
    expect(posts[1]).toContain(`${"L".repeat(59)}… (#e-long)`);
  });

  test("caps posts per run and adds a +N more post", async () => {
    const failures = Array.from({ length: 13 }, (_, i) => ({ event: `E${i}`, channel: `e-${i}`, op: "archive", error: "x" }));
    const { posts } = await runWith(failures);
    expect(posts).toHaveLength(11);
    expect(posts[10]).toContain("+3 more failing channels");
  });

  test("a throwing alert post still records heartbeat + health and returns 200", async () => {
    const { postChannelMessage } = await import("@/lib/slack");
    vi.mocked(postChannelMessage).mockRejectedValue(new Error("slack down"));
    const { res, report, heartbeat } = await runWith([{ event: "A", channel: "e-a", op: "archive", error: "x" }]);
    expect(res.status).toBe(200);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("slack_event_channels", false, expect.anything());
  });
});

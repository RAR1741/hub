import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-membership-sync-secret";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));
vi.mock("@/lib/slack-link", () => ({
  syncSlackLinks: vi.fn(),
}));
vi.mock("@/lib/team-slack-backfill", () => ({
  reconcileAllTeamSlackChannels: vi.fn(),
}));
vi.mock("@/lib/slack-alerts", () => ({
  reportSyncOutcome: vi.fn(),
}));

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/slack/membership-sync", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/slack/membership-sync", () => {
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

  test("200 runs link sync before channel reconcile and reports success", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { syncSlackLinks } = await import("@/lib/slack-link");
    const { reconcileAllTeamSlackChannels } = await import("@/lib/team-slack-backfill");
    const { reportSyncOutcome } = await import("@/lib/slack-alerts");
    vi.mocked(getSetting).mockResolvedValue(SECRET);

    const order: string[] = [];
    vi.mocked(syncSlackLinks).mockImplementation(async () => {
      order.push("links");
      return { ranAt: "now", linked: 1, alreadyLinked: 0, ambiguous: [], unmatchedSlack: [], unmatchedPeople: [] };
    });
    vi.mocked(reconcileAllTeamSlackChannels).mockImplementation(async () => {
      order.push("channels");
      return { slackConfigured: true, teamsWithChannels: 0, totals: { invited: 0, alreadyIn: 0, wouldRemove: 0, failed: 0, skippedNoSlack: 0, channels: 0 }, teams: [] };
    });

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(order).toEqual(["links", "channels"]);
    expect(reportSyncOutcome).toHaveBeenCalledWith("slack_sync", true, expect.anything());
  });

  test("502 and reports failure when the chain throws", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { syncSlackLinks } = await import("@/lib/slack-link");
    const { reportSyncOutcome } = await import("@/lib/slack-alerts");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(syncSlackLinks).mockRejectedValue(new Error("boom"));

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "sync_failed" });
    expect(reportSyncOutcome).toHaveBeenCalledWith("slack_sync", false, expect.objectContaining({ error: "boom" }));
  });

  test("502 and reports failure when the channel reconcile throws after link sync succeeds", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { syncSlackLinks } = await import("@/lib/slack-link");
    const { reconcileAllTeamSlackChannels } = await import("@/lib/team-slack-backfill");
    const { reportSyncOutcome } = await import("@/lib/slack-alerts");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(syncSlackLinks).mockResolvedValue({
      ranAt: "now",
      linked: 1,
      alreadyLinked: 0,
      ambiguous: [],
      unmatchedSlack: [],
      unmatchedPeople: [],
    });
    vi.mocked(reconcileAllTeamSlackChannels).mockRejectedValue(new Error("db error"));

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "sync_failed" });
    expect(reportSyncOutcome).toHaveBeenCalledWith("slack_sync", false, expect.objectContaining({ error: "db error" }));
  });
});

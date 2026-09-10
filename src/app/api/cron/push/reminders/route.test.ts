import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-push-reminders-secret";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));
vi.mock("@/lib/event-reminder", () => ({
  pushEventReminders: vi.fn(),
}));
vi.mock("@/lib/meeting-reminder", () => ({
  pushMeetingReminders: vi.fn(),
}));

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/cron/push/reminders", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/push/reminders", () => {
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

  test("200 with shape { ok, events, meetings } on valid secret", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { pushEventReminders } = await import("@/lib/event-reminder");
    const { pushMeetingReminders } = await import("@/lib/meeting-reminder");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    const eventsResult = { sent: 1, pruned: 0, events: 1 };
    const meetingsResult = { sent: 2, pruned: 0, meetings: 1 };
    vi.mocked(pushEventReminders).mockResolvedValue(eventsResult);
    vi.mocked(pushMeetingReminders).mockResolvedValue(meetingsResult);

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, events: eventsResult, meetings: meetingsResult });
  });

  test("502 when a sweep throws", async () => {
    const { getSetting } = await import("@/lib/settings");
    const { pushEventReminders } = await import("@/lib/event-reminder");
    const { pushMeetingReminders } = await import("@/lib/meeting-reminder");
    vi.mocked(getSetting).mockResolvedValue(SECRET);
    vi.mocked(pushEventReminders).mockRejectedValue(new Error("boom"));
    vi.mocked(pushMeetingReminders).mockResolvedValue({ sent: 0, pruned: 0, meetings: 0 });

    const { POST } = await import("./route");
    const res = await POST(req({ "x-sync-secret": SECRET }));
    expect(res.status).toBe(502);
  });
});

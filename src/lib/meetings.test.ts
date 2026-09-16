import { describe, expect, test, vi } from "vitest";
vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 0, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";
import {
  createManualMeeting, deleteMeeting, listAllMeetings, listUpcomingMeetings, notifyMeetingChanged,
  parseMeetingInput, updateMeeting,
} from "./meetings";

describe("listUpcomingMeetings", () => {
  test("passes the now filter + limit and maps rows", async () => {
    const captured: Record<string, unknown> = {};
    const rows = [
      {
        id: "m1", gcal_event_id: "g1", title: "Build",
        starts_at: "2026-09-02T22:00:00Z", ends_at: "2026-09-03T01:00:00Z",
        synced_at: "2026-08-31T00:00:00Z",
      },
    ];
    const db = {
      from: () => ({
        select: () => ({
          gte: (_col: string, val: string) => {
            captured.gte = val;
            return {
              order: () => ({
                limit: (n: number) => {
                  captured.limit = n;
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            };
          },
        }),
      }),
    } as never;
    const result = await listUpcomingMeetings("2026-09-01T00:00:00Z", 5, db);
    expect(captured.gte).toBe("2026-09-01T00:00:00Z");
    expect(captured.limit).toBe(5);
    expect(result[0]).toMatchObject({ id: "m1", gcalEventId: "g1", title: "Build" });
  });
});

describe("listAllMeetings", () => {
  test("orders by starts_at desc and maps rows", async () => {
    const rows = [
      {
        id: "m1", gcal_event_id: null, title: "Manual meeting",
        starts_at: "2026-09-02T22:00:00Z", ends_at: "2026-09-03T01:00:00Z",
        synced_at: "2026-08-31T00:00:00Z",
      },
    ];
    const captured: Record<string, unknown> = {};
    const db = {
      from: () => ({
        select: () => ({
          order: (col: string, opts: unknown) => {
            captured.order = col;
            captured.opts = opts;
            return { limit: () => Promise.resolve({ data: rows, error: null }) };
          },
        }),
      }),
    } as never;
    const result = await listAllMeetings(db);
    expect(captured.order).toBe("starts_at");
    expect(captured.opts).toEqual({ ascending: false });
    expect(result[0]).toMatchObject({ id: "m1", gcalEventId: null, title: "Manual meeting" });
  });
});

describe("parseMeetingInput", () => {
  test("accepts a valid meeting and normalizes ISO datetimes", () => {
    expect(
      parseMeetingInput({
        title: " Build Session ",
        startsAt: "2026-09-01T18:00:00.000Z",
        endsAt: "2026-09-01T20:00:00Z",
      }),
    ).toEqual({
      title: "Build Session",
      startsAt: "2026-09-01T18:00:00.000Z",
      endsAt: "2026-09-01T20:00:00.000Z",
    });
  });

  test("accepts endsAt equal to startsAt", () => {
    const input = parseMeetingInput({
      title: "Instant",
      startsAt: "2026-09-01T18:00:00Z",
      endsAt: "2026-09-01T18:00:00Z",
    });
    expect(input).not.toBeNull();
  });

  test.each([
    [{ title: "", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" }], // missing title
    [{ title: "X", startsAt: "not-a-date", endsAt: "2026-09-01T20:00:00Z" }], // bad ISO start
    [{ title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "not-a-date" }], // bad ISO end
    [{ title: "X", startsAt: "2026-09-01T20:00:00Z", endsAt: "2026-09-01T18:00:00Z" }], // endsAt < startsAt
    [{ title: "X", startsAt: "2026-09-01T18:00:00Z" }], // missing endsAt
    [null],
  ])("rejects %j", (body) => {
    expect(parseMeetingInput(body)).toBeNull();
  });
});

describe("createManualMeeting", () => {
  test("inserts with gcal_event_id = null", async () => {
    const captured: Record<string, unknown> = {};
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          captured.row = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: "m1" }, error: null }),
            }),
          };
        },
      }),
    } as never;
    const result = await createManualMeeting(
      { title: "Build", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      db,
    );
    expect(result).toEqual({ ok: true, id: "m1" });
    expect(captured.row).toMatchObject({ gcal_event_id: null, title: "Build" });
  });
});

describe("notifyMeetingChanged", () => {
  test("pushes meeting_changed to all and resets the reminder stamp", async () => {
    const update = vi.fn().mockReturnValue({ eq: () => ({ error: null }) });
    const db = { from: () => ({ update }) } as never;
    await notifyMeetingChanged(db, { id: "m1", title: "Build", starts_at: "2026-09-07T22:00:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      "all",
      "meeting_changed",
      expect.objectContaining({ url: "/calendar" }),
      expect.objectContaining({ db }),
    );
    expect(update).toHaveBeenCalledWith({ reminder_pushed_minutes: [] });
  });
});

describe("updateMeeting", () => {
  // priorStartsAt = what the row's starts_at was before this update.
  function fakeDb(found: boolean, priorStartsAt?: string) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: priorStartsAt !== undefined ? { starts_at: priorStartsAt } : null,
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: found ? { id: "m1", title: "X", starts_at: "2026-09-01T18:00:00Z" } : null,
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as never;
  }
  test("404 when missing", async () => {
    const result = await updateMeeting(
      "m1",
      { title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      fakeDb(false),
    );
    expect(result).toEqual({ ok: false, status: 404 });
  });
  test("ok when found", async () => {
    const result = await updateMeeting(
      "m1",
      { title: "X", startsAt: "2026-09-01T18:00:00Z", endsAt: "2026-09-01T20:00:00Z" },
      fakeDb(true),
    );
    expect(result).toEqual({ ok: true, status: 200 });
  });

  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  test("fires notifyMeetingChanged when starts_at moved to a future time", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    await updateMeeting(
      "m1",
      { title: "X", startsAt: FUTURE, endsAt: FUTURE },
      fakeDb(true, "2020-01-01T00:00:00Z"),
    );
    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
  });

  test("does NOT fire when starts_at is unchanged (same instant, different format)", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    // Same instant as FUTURE, but the DB row's prior value carries a
    // non-UTC offset instead of "Z" — a string compare would wrongly see
    // this as a change.
    const futureOffset = new Date(new Date(FUTURE).getTime() - 4 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", "-04:00");
    await updateMeeting(
      "m1",
      { title: "X", startsAt: FUTURE, endsAt: FUTURE },
      fakeDb(true, futureOffset),
    );
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
  });

  test("fires when starts_at genuinely moves to a different instant", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const laterStill = new Date(new Date(FUTURE).getTime() + 60 * 60 * 1000).toISOString();
    await updateMeeting(
      "m1",
      { title: "X", startsAt: laterStill, endsAt: laterStill },
      fakeDb(true, FUTURE),
    );
    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
  });

  test("does NOT fire when the new starts_at is in the past", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    await updateMeeting(
      "m1",
      { title: "X", startsAt: PAST, endsAt: PAST },
      fakeDb(true, "2020-01-01T00:00:00Z"),
    );
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
  });
});

describe("deleteMeeting", () => {
  function fakeDb(found: boolean) {
    return {
      from: () => ({
        delete: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: found ? { id: "m1" } : null, error: null }),
            }),
          }),
        }),
      }),
    } as never;
  }
  test("404 when missing", async () => {
    expect(await deleteMeeting("m1", fakeDb(false))).toEqual({ ok: false, status: 404 });
  });
  test("ok when found", async () => {
    expect(await deleteMeeting("m1", fakeDb(true))).toEqual({ ok: true, status: 200 });
  });
});

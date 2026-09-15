// src/lib/meeting-reminder.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { pushMeetingReminders } from "./meeting-reminder";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 5, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

type MeetingRow = { id: string; title: string; starts_at: string; reminder_pushed_minutes: number[] };

/** `select` always replays the *initial* rows, so calling pushMeetingReminders
 *  twice models two ticks that both read the pre-claim state. The claim update
 *  is a compare-and-swap against the live state: it matches only when the stored
 *  reminder_pushed_minutes does not overlap the offsets being claimed. */
function fakeDb(rows: MeetingRow[], personIds: string[]) {
  const stamped: { id: string; reminder_pushed_minutes: number[] }[] = [];
  const live = new Map(rows.map((r) => [r.id, [...r.reminder_pushed_minutes]]));
  const db = {
    _stamped: stamped,
    from: (table: string) => {
      if (table === "meeting") {
        return {
          select: () => ({
            gte: () => ({ lte: () => ({ data: rows.map((r) => ({ ...r })), error: null }) }),
          }),
          update: (body: { reminder_pushed_minutes: number[] }) => ({
            eq: (_c: string, id: string) => ({
              not: (_c2: string, _op: string, literal: string) => ({
                select: () => {
                  const current = live.get(id);
                  const claiming = literal.slice(1, -1).split(",").map(Number);
                  if (!current || current.some((m) => claiming.includes(m))) {
                    return { data: [], error: null };
                  }
                  live.set(id, body.reminder_pushed_minutes);
                  stamped.push({ id, reminder_pushed_minutes: body.reminder_pushed_minutes });
                  return { data: [{ id }], error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "person") {
        return {
          select: () => ({
            overlaps: () => ({ data: personIds.map((id) => ({ id })), error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return db as unknown as SupabaseClient & { _stamped: { id: string; reminder_pushed_minutes: number[] }[] };
}

describe("pushMeetingReminders", () => {
  test("due offset not in reminder_pushed_minutes → stamp union + push to overlapping persons", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb(
      [{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z", reminder_pushed_minutes: [] }],
      ["p1", "p2"],
    );
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      ["p1", "p2"],
      "meeting_reminder",
      expect.objectContaining({ url: "/calendar" }),
      expect.objectContaining({ db }),
    );
    expect(db._stamped).toEqual([{ id: "m1", reminder_pushed_minutes: [30, 60, 120] }]);
    expect(res.meetings).toBe(1);
    expect(res.sent).toBe(5);
  });

  test("offset already in reminder_pushed_minutes → skipped", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    // All due offsets (30, 60, 120 at T=30min) already stamped → nothing left due.
    const db = fakeDb(
      [{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z", reminder_pushed_minutes: [30, 60, 120] }],
      ["p1"],
    );
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db._stamped).toEqual([]);
    expect(res).toEqual({ sent: 0, pruned: 0, meetings: 0 });
  });

  test("a second overlapping tick loses the compare-and-swap → no second push", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    // Both ticks read the same pre-claim state; the second one's CAS must fail.
    const db = fakeDb(
      [{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z", reminder_pushed_minutes: [] }],
      ["p1"],
    );
    await pushMeetingReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T21:31:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
    expect(db._stamped).toHaveLength(1);
    expect(res).toEqual({ sent: 0, pruned: 0, meetings: 0 });
  });

  test("person select errors → no push, no stamp (retried on next tick)", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const stamped: { id: string; reminder_pushed_minutes: number[] }[] = [];
    const db = {
      from: (table: string) => {
        if (table === "meeting") {
          return {
            select: () => ({
              gte: () => ({
                lte: () => ({
                  data: [{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z", reminder_pushed_minutes: [] }],
                  error: null,
                }),
              }),
            }),
            update: (body: { reminder_pushed_minutes: number[] }) => ({
              eq: (_c: string, id: string) => ({
                not: () => ({
                  select: () => {
                    stamped.push({ id, reminder_pushed_minutes: body.reminder_pushed_minutes });
                    return { data: [{ id }], error: null };
                  },
                }),
              }),
            }),
          };
        }
        if (table === "person") {
          return { select: () => ({ overlaps: () => ({ data: null, error: { message: "boom" } }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(stamped).toEqual([]);
    expect(res).toEqual({ sent: 0, pruned: 0, meetings: 0 });
  });

  test("no overlapping persons → still stamped, no push", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb(
      [{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z", reminder_pushed_minutes: [] }],
      [],
    );
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db._stamped).toEqual([{ id: "m1", reminder_pushed_minutes: [30, 60, 120] }]);
    expect(res.meetings).toBe(0);
    expect(res.sent).toBe(0);
  });
});

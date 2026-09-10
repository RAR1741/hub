// src/lib/event-reminder.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { pushEventReminders } from "./event-reminder";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 1, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

type EventRow = { id: string; name: string; starts_at: string };
type ReminderRow = { event_id: string; person_id: string; minutes: number };

function fakeDb(events: EventRow[], reminders: ReminderRow[]) {
  const updates: { eventId: string; minutes: number[] }[] = [];
  const db = {
    _updates: updates,
    from: (table: string) => {
      if (table === "event") {
        return {
          select: () => ({
            gte: () => ({ lte: () => ({ data: events, error: null }) }),
          }),
        };
      }
      if (table === "event_signup_reminder") {
        return {
          select: () => ({
            in: () => ({ is: () => ({ data: reminders, error: null }) }),
          }),
          update: (body: { pushed_at: string }) => ({
            eq: (_c: string, eventId: string) => ({
              in: (_c2: string, minutes: number[]) => {
                updates.push({ eventId, minutes });
                return { is: () => ({ error: null, ...body }) };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return db as unknown as SupabaseClient & { _updates: { eventId: string; minutes: number[] }[] };
}

describe("pushEventReminders", () => {
  test("due offset → push to that person + row stamped", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb(
      [{ id: "e1", name: "Regionals", starts_at: "2026-09-06T22:00:00Z" }],
      [{ event_id: "e1", person_id: "p1", minutes: 30 }],
    );
    const res = await pushEventReminders({ db, nowIso: "2026-09-06T21:30:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      ["p1"],
      null,
      expect.objectContaining({ title: "Regionals", url: "/events/e1" }),
      expect.objectContaining({ db }),
    );
    expect(db._updates).toEqual([{ eventId: "e1", minutes: [30, 60, 120] }]);
    expect(res.events).toBe(1);
    expect(res.sent).toBe(1);
  });

  test("offset not yet due → no push, not stamped", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb(
      [{ id: "e1", name: "Regionals", starts_at: "2026-09-06T22:00:00Z" }],
      // 25 min before start: only 15 is not due (needs m >= 25); 15 stays pending.
      [{ event_id: "e1", person_id: "p1", minutes: 15 }],
    );
    const res = await pushEventReminders({ db, nowIso: "2026-09-06T21:35:00Z" });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(db._updates).toEqual([]);
    expect(res).toEqual({ sent: 0, pruned: 0, events: 0 });
  });

  test(".error on a select → returns zeros", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = {
      from: () => ({
        select: () => ({ gte: () => ({ lte: () => ({ data: null, error: { message: "boom" } }) }) }),
      }),
    } as unknown as SupabaseClient;
    const res = await pushEventReminders({ db, nowIso: "2026-09-06T20:00:00Z" });
    expect(res).toEqual({ sent: 0, pruned: 0, events: 0 });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
  });

  test("two signups on same event with different due offsets → recipients deduped, single push", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb(
      [{ id: "e1", name: "Regionals", starts_at: "2026-09-06T22:00:00Z" }],
      [
        { event_id: "e1", person_id: "p1", minutes: 30 },
        { event_id: "e1", person_id: "p1", minutes: 60 },
        { event_id: "e1", person_id: "p2", minutes: 60 },
      ],
    );
    const res = await pushEventReminders({ db, nowIso: "2026-09-06T21:00:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledTimes(1);
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      expect.arrayContaining(["p1", "p2"]),
      null,
      expect.anything(),
      expect.anything(),
    );
    const [recipients] = vi.mocked(sendPushToOptedIn).mock.calls[0];
    expect(recipients).toHaveLength(2);
    expect(db._updates).toEqual([{ eventId: "e1", minutes: [60, 120] }]);
    expect(res.events).toBe(1);
  });
});

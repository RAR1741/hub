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

function fakeDb(rows: MeetingRow[], personIds: string[]) {
  const stamped: { id: string; reminder_pushed_minutes: number[] }[] = [];
  const db = {
    _stamped: stamped,
    from: (table: string) => {
      if (table === "meeting") {
        return {
          select: () => ({
            gte: () => ({ lte: () => ({ data: rows, error: null }) }),
          }),
          update: (body: { reminder_pushed_minutes: number[] }) => ({
            eq: (_c: string, id: string) => {
              stamped.push({ id, reminder_pushed_minutes: body.reminder_pushed_minutes });
              return { error: null };
            },
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
  test("due offset not in reminder_pushed_minutes → push to overlapping persons + stamp union", async () => {
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
              eq: (_c: string, id: string) => {
                stamped.push({ id, reminder_pushed_minutes: body.reminder_pushed_minutes });
                return { error: null };
              },
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

// src/lib/meeting-reminder.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { pushMeetingReminders } from "./meeting-reminder";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 5, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

type MeetingRow = { id: string; title: string; starts_at: string };

function fakeDb(rows: MeetingRow[]) {
  const stamped: string[] = [];
  const db = {
    _stamped: stamped,
    from: () => ({
      select: () => ({
        gte: () => ({ lte: () => ({ is: () => ({ data: rows, error: null }) }) }),
      }),
      update: () => ({
        eq: (_c: string, id: string) => {
          stamped.push(id);
          return { error: null };
        },
      }),
    }),
  };
  return db as unknown as SupabaseClient & { _stamped: string[] };
}

describe("pushMeetingReminders", () => {
  test("reminds meetings in the next 3h once, stamps them, targets all", async () => {
    const db = fakeDb([{ id: "m1", title: "Build", starts_at: "2026-09-06T22:00:00Z" }]);
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T20:00:00Z" });
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      "all",
      "meeting_reminder",
      expect.objectContaining({ url: "/calendar" }),
      expect.objectContaining({ db }),
    );
    expect(db._stamped).toContain("m1");
    expect(res.meetings).toBe(1);
    expect(res.sent).toBe(5);
  });

  test("no upcoming meetings → no send", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb([]);
    const res = await pushMeetingReminders({ db, nowIso: "2026-09-06T20:00:00Z" });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, pruned: 0, meetings: 0 });
  });
});

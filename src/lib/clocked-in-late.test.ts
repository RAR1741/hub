// src/lib/clocked-in-late.test.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { pushClockedInLate } from "./clocked-in-late";

vi.mock("./push-dispatch", () => ({
  pushDepsFromEnv: () => null,
  sendPushToOptedIn: vi.fn().mockResolvedValue({ sent: 2, pruned: 0 }),
}));
import { sendPushToOptedIn } from "./push-dispatch";

function fakeDb(rows: Array<{ person_id: string }>) {
  return {
    from: () => ({
      select: () => ({ is: () => ({ data: rows, error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe("pushClockedInLate", () => {
  test("targets persons with an open session (time_out is null)", async () => {
    const db = fakeDb([{ person_id: "p1" }, { person_id: "p2" }, { person_id: "p1" }]);
    await pushClockedInLate({ db });
    expect(sendPushToOptedIn).toHaveBeenCalledWith(
      expect.arrayContaining(["p1", "p2"]),
      "clocked_in_late",
      expect.objectContaining({ url: "/me/attendance" }),
      expect.objectContaining({ db }),
    );
    // dedupes p1
    const ids = vi.mocked(sendPushToOptedIn).mock.calls[0][0] as string[];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no open sessions → no send", async () => {
    vi.mocked(sendPushToOptedIn).mockClear();
    const db = fakeDb([]);
    const res = await pushClockedInLate({ db });
    expect(sendPushToOptedIn).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, pruned: 0 });
  });
});

import { describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRescheduleInput, parseRunInput, RUN_CONFIRM_MESSAGES, runCronJob } from "./cron-jobs";

describe("parseRescheduleInput", () => {
  test("accepts a valid payload and trims schedule", () => {
    expect(parseRescheduleInput({ jobId: 1, schedule: "  30 seconds  " })).toEqual({
      jobId: 1,
      schedule: "30 seconds",
    });
  });
  test.each([
    [null],
    [{ jobId: 1 }],
    [{ jobId: 0, schedule: "* * * * *" }],
    [{ jobId: -1, schedule: "* * * * *" }],
    [{ jobId: 1.5, schedule: "* * * * *" }],
    [{ jobId: "1", schedule: "* * * * *" }],
    [{ jobId: 1, schedule: "" }],
    [{ jobId: 1, schedule: "   " }],
    [{ jobId: 1, schedule: "x".repeat(201) }],
    [{ jobId: 1, schedule: 5 }],
  ])("rejects %j", (b) => expect(parseRescheduleInput(b)).toBeNull());
});

describe("parseRunInput", () => {
  test("accepts a positive integer jobId", () => {
    expect(parseRunInput({ jobId: 7 })).toEqual({ jobId: 7 });
  });
  test.each([[null], [{}], [{ jobId: 0 }], [{ jobId: -1 }], [{ jobId: 1.5 }], [{ jobId: "1" }]])(
    "rejects %j",
    (b) => expect(parseRunInput(b)).toBeNull(),
  );
});

describe("runCronJob", () => {
  const mk = (error: { message: string } | null) => {
    const rpc = vi.fn().mockResolvedValue({ error });
    return { rpc, db: { rpc } as unknown as SupabaseClient };
  };
  test("calls run_cron_job rpc", async () => {
    const { rpc, db } = mk(null);
    expect(await runCronJob({ jobId: 3 }, db)).toEqual({ ok: true, status: 200 });
    expect(rpc).toHaveBeenCalledWith("run_cron_job", { job_id: 3 });
  });
  test("maps rpc error", async () => {
    const { db } = mk({ message: "cron job 9 not found" });
    expect(await runCronJob({ jobId: 9 }, db)).toEqual({
      ok: false,
      status: 400,
      error: "cron job 9 not found",
    });
  });
});

test("RUN_CONFIRM_MESSAGES covers side-effectful jobs", () => {
  expect(Object.keys(RUN_CONFIRM_MESSAGES).sort()).toEqual([
    "close-stale-sessions",
    "push-clocked-in-late",
    "push-reminders",
    "slack-mentor-reminders-weekly",
    "slack-whats-new-weekly",
  ]);
});

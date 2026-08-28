import { describe, expect, test } from "vitest";
import { parseRescheduleInput } from "./cron-jobs";

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

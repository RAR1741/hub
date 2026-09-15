import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("./system-health", () => ({ reportSubsystemHealth: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./cron-jobs", () => ({ listCronJobs: vi.fn() }));

import { checkCronHeartbeats, cronPeriodMs, isCronStale, recordCronHeartbeat } from "./cron-heartbeat";
import { reportSubsystemHealth } from "./system-health";
import { listCronJobs } from "./cron-jobs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => vi.clearAllMocks());

describe("cronPeriodMs", () => {
  test.each([
    ["*/5 * * * *", 5 * MINUTE],
    ["*/15 * * * *", 15 * MINUTE],
    ["0 * * * *", HOUR],
    ["0 */6 * * *", 6 * HOUR],
    ["0 7 * * *", DAY],
    ["0 23 * * 4", 7 * DAY],
    ["nonsense", DAY],
    ["0,30 * * * *", HOUR], // unrecognized minute field, but still hourly at most
    ["*/0 * * * *", HOUR],
  ])("%s", (schedule, expected) => {
    expect(cronPeriodMs(schedule)).toBe(expected);
  });
});

describe("isCronStale", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("never run is stale", () => {
    expect(isCronStale("0 7 * * *", null, now)).toBe(true);
  });

  test("a nightly job is fine a day late but not two", () => {
    expect(isCronStale("0 7 * * *", ago(DAY + HOUR), now)).toBe(false);
    expect(isCronStale("0 7 * * *", ago(2 * DAY), now)).toBe(true);
  });

  test("a 5-minute job gets the 15-minute floor, not a 75-second one", () => {
    expect(isCronStale("*/5 * * * *", ago(15 * MINUTE), now)).toBe(false);
    expect(isCronStale("*/5 * * * *", ago(30 * MINUTE), now)).toBe(true);
  });

  test("a weekly job is not stale after 8 days of one missed-ish run", () => {
    expect(isCronStale("0 13 * * 1", ago(8 * DAY), now)).toBe(false);
    expect(isCronStale("0 13 * * 1", ago(10 * DAY), now)).toBe(true);
  });

  test("an unparseable timestamp is stale, not silently fresh", () => {
    expect(isCronStale("0 7 * * *", "not-a-date", now)).toBe(true);
  });
});

describe("checkCronHeartbeats", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const job = (over: Partial<Awaited<ReturnType<typeof listCronJobs>>[number]>) => ({
    jobid: 1,
    jobname: "push-reminders",
    schedule: "*/5 * * * *",
    active: true,
    lastRunStartedAt: null,
    lastRunStatus: null,
    lastSuccessAt: new Date(now).toISOString(),
    ...over,
  });

  test("reports each active job under its own key and skips inactive ones", async () => {
    vi.mocked(listCronJobs).mockResolvedValue([
      job({}),
      job({ jobid: 2, jobname: "slack-nightly-sync", schedule: "40 7 * * *", lastSuccessAt: null }),
      job({ jobid: 3, jobname: "gcal-hourly-sync", schedule: "0 * * * *", active: false }),
    ]);

    await checkCronHeartbeats({} as never, now);

    expect(reportSubsystemHealth).toHaveBeenCalledTimes(2);
    expect(reportSubsystemHealth).toHaveBeenCalledWith("cron_push-reminders", true, expect.anything());
    expect(reportSubsystemHealth).toHaveBeenCalledWith(
      "cron_slack-nightly-sync",
      false,
      expect.objectContaining({ detail: "Has never recorded a successful run." }),
    );
  });

  test("a failing job list never throws into the caller", async () => {
    vi.mocked(listCronJobs).mockRejectedValue(new Error("rpc down"));
    await expect(checkCronHeartbeats({} as never, now)).resolves.toBeUndefined();
  });
});

describe("recordCronHeartbeat", () => {
  test("upserts one app_setting row and swallows a db error", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: "nope" } });
    const db = { from: vi.fn().mockReturnValue({ upsert }) };

    await expect(recordCronHeartbeat("push-reminders", db as never)).resolves.toBeUndefined();

    expect(db.from).toHaveBeenCalledWith("app_setting");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cron_heartbeat_push-reminders" }),
      { onConflict: "key" },
    );
  });
});

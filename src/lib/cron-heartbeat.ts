import type { SupabaseClient } from "@supabase/supabase-js";
import { listCronJobs, type CronJob } from "./cron-jobs";
import { reportSubsystemHealth } from "./system-health";

/** pg_cron job names, as scheduled by supabase/migrations/*_cron.sql. The handler each
 *  job posts to records its own heartbeat under this name; the staleness check reads the
 *  live job list, so a job renamed in a migration without renaming it here reads as
 *  permanently stale rather than silently unmonitored. */
export type CronJobName =
  | "gcal-hourly-sync"
  | "first-roster-sync"
  | "drive-group-nightly-sync"
  | "github-team-nightly-sync"
  | "slack-nightly-sync"
  | "slack-mentor-reminders-weekly"
  | "slack-event-channels-nightly"
  | "slack-whats-new-weekly"
  | "push-clocked-in-late"
  | "push-reminders";

/** Record that this job's work actually completed. Call it only on the cron (shared
 *  secret) path — an admin clicking "Sync now" must not refresh the heartbeat, or the
 *  failure mode this exists to catch (secret unset in prod → every cron run 403s before
 *  the handler) stays invisible. Never throws: a heartbeat is not worth failing a sync. */
export async function recordCronHeartbeat(job: CronJobName, db: SupabaseClient): Promise<void> {
  try {
    const { error } = await db
      .from("app_setting")
      .upsert({ key: `cron_heartbeat_${job}`, value: new Date().toISOString() }, { onConflict: "key" });
    if (error) console.error(`[cron-heartbeat] upsert failed for ${job}:`, error.message);
  } catch (e) {
    console.error(`[cron-heartbeat] recordCronHeartbeat(${job}) threw:`, e);
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Approximate how often a 5-field cron expression fires, in ms. PURE.
 *  ponytail: covers the shapes we actually schedule (every-N-minutes, every-N-hours,
 *  fixed-minute hourly, daily, weekly); anything else is treated as daily. Swap in a real
 *  cron parser if the schedules get exotic. */
export function cronPeriodMs(schedule: string): number {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return DAY;
  const [minute, hour, , , weekday] = fields;

  const everyNMinutes = /^\*\/([1-9]\d*)$/.exec(minute);
  if (everyNMinutes && hour === "*") return Number(everyNMinutes[1]) * MINUTE;

  const everyNHours = /^\*\/([1-9]\d*)$/.exec(hour);
  if (everyNHours) return Number(everyNHours[1]) * HOUR;

  if (hour === "*") return HOUR;
  if (weekday !== "*") return WEEK;
  return DAY;
}

/** True when the job should have succeeded by now and hasn't. PURE. Allowance is one
 *  full period plus a quarter of one (at least 15 min), so a single skipped or slow run
 *  doesn't alert but a job that stopped firing does. */
export function isCronStale(schedule: string, lastSuccessAt: string | null, now: number): boolean {
  if (lastSuccessAt === null) return true;
  const last = Date.parse(lastSuccessAt);
  if (Number.isNaN(last)) return true;
  const period = cronPeriodMs(schedule);
  return now - last > period + Math.max(15 * MINUTE, period / 4);
}

function staleDetail(job: CronJob): string {
  return job.lastSuccessAt === null
    ? "Has never recorded a successful run."
    : `Hasn't succeeded since ${job.lastSuccessAt}.`;
}

/** Push a health transition per active cron job whose last success is overdue for its own
 *  schedule. Keyed per job (not one shared key) so a second job going stale still alerts
 *  while the first is down. Never throws — the caller is itself a cron handler. */
export async function checkCronHeartbeats(db: SupabaseClient, now = Date.now()): Promise<void> {
  try {
    const jobs = await listCronJobs(db);
    for (const job of jobs.filter((j) => j.active)) {
      const stale = isCronStale(job.schedule, job.lastSuccessAt, now);
      await reportSubsystemHealth(`cron_${job.jobname}`, !stale, { db, detail: staleDetail(job) });
    }
  } catch (e) {
    console.error("[cron-heartbeat] checkCronHeartbeats threw:", e);
  }
}

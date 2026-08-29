import type { SupabaseClient } from "@supabase/supabase-js";

export type CronJob = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  lastRunStartedAt: string | null;
  lastRunStatus: string | null;
};

export async function listCronJobs(db?: SupabaseClient): Promise<CronJob[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client.rpc("list_cron_jobs");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    jobid: row.jobid as number,
    jobname: row.jobname as string,
    schedule: row.schedule as string,
    active: row.active as boolean,
    lastRunStartedAt: row.last_run_started_at as string | null,
    lastRunStatus: row.last_run_status as string | null,
  }));
}

export type RescheduleInput = { jobId: number; schedule: string };

/** Validate the reschedule payload. PURE. Does not validate cron expression syntax —
 * pg_cron accepts both 5-field cron and interval syntax (e.g. "30 seconds"). */
export function parseRescheduleInput(body: unknown): RescheduleInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.jobId !== "number" || !Number.isInteger(b.jobId) || b.jobId <= 0) return null;
  const schedule = typeof b.schedule === "string" ? b.schedule.trim() : null;
  if (schedule === null || schedule.length === 0 || schedule.length > 200) return null;
  return { jobId: b.jobId, schedule };
}

export async function rescheduleCronJob(
  input: RescheduleInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.rpc("reschedule_cron_job", {
    job_id: input.jobId,
    new_schedule: input.schedule,
  });
  if (error) return { ok: false, status: 400, error: error.message };
  return { ok: true, status: 200 };
}

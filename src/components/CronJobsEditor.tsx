"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CronJob } from "@/lib/cron-jobs";

type RowState = { schedule: string; busy: boolean; status: string | null; error: string | null };

function formatLastRun(job: CronJob, teamTz: string): string {
  if (!job.lastRunStartedAt) return "never";
  const when = new Date(job.lastRunStartedAt).toLocaleString(undefined, { timeZone: teamTz });
  return job.lastRunStatus ? `${when} (${job.lastRunStatus})` : when;
}

export function CronJobsEditor({ jobs, teamTz }: { jobs: CronJob[]; teamTz: string }) {
  const [rows, setRows] = useState<Record<number, RowState>>(() =>
    Object.fromEntries(jobs.map((job) => [job.jobid, { schedule: job.schedule, busy: false, status: null, error: null }])),
  );
  const router = useRouter();

  function setRow(jobId: number, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [jobId]: { ...prev[jobId], ...patch } }));
  }

  async function save(jobId: number) {
    const schedule = rows[jobId].schedule.trim();
    if (!schedule) return;
    setRow(jobId, { busy: true, status: null, error: null });
    try {
      const res = await fetch("/api/admin/cron", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, schedule }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRow(jobId, { busy: false, status: "Saved.", error: null });
        router.refresh();
      } else {
        setRow(jobId, { busy: false, status: null, error: body.error ?? "Save failed." });
      }
    } catch {
      setRow(jobId, { busy: false, status: null, error: "Save failed." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[var(--color-muted-fg)]">
        Schedules run in UTC, using standard 5-field cron syntax (minute hour day month weekday).
      </p>
      <div className="flex flex-col gap-4">
        {jobs.map((job) => {
          const row = rows[job.jobid] ?? { schedule: job.schedule, busy: false, status: null, error: null };
          return (
            <div key={job.jobid} className="flex flex-col gap-2 border-b border-[var(--steel)] pb-4 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{job.jobname}</span>
                <span className="text-[13px] text-[var(--muted)]">
                  {job.active ? "active" : "inactive"} · last run: {formatLastRun(job, teamTz)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input"
                  value={row.schedule}
                  onChange={(e) => setRow(job.jobid, { schedule: e.target.value, status: null, error: null })}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={row.busy || row.schedule.trim().length === 0}
                  onClick={() => save(job.jobid)}
                >
                  {row.busy ? "Saving…" : "Save"}
                </button>
              </div>
              {row.status && <p role="status" className="text-sm text-[var(--color-muted-fg)]">{row.status}</p>}
              {row.error && <p role="status" className="text-sm text-[var(--red)]">{row.error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

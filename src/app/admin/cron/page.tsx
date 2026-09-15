import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listCronJobsWithStaleness } from "@/lib/cron-heartbeat";
import { getTeamTimezone } from "@/lib/settings";
import { CronJobsEditor } from "@/components/CronJobsEditor";

export const metadata: Metadata = { title: "Cron Jobs" };

export default async function AdminCronPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  // Staleness resolved server-side so the client component stays free of the
  // server-only cron-heartbeat module.
  const jobs = await listCronJobsWithStaleness();
  const teamTz = await getTeamTimezone();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Cron jobs</h1>
          <div className="sub">View and edit pg_cron schedules</div>
        </div>
      </div>
      <p className="text-[13px] text-[var(--muted)]">
        Schedules are seeded by migrations, then editable here. Edits reschedule the job
        immediately and override the migration value until changed again. &ldquo;Last run&rdquo; is
        pg_cron firing the job; &ldquo;last success&rdquo; is the work itself reporting back, so a job
        marked overdue is reaching pg_cron but not finishing (or not reaching the app at all).
      </p>
      <section className="card flex flex-col gap-4">
        <CronJobsEditor jobs={jobs} teamTz={teamTz} />
      </section>
    </main>
  );
}

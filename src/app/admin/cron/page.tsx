import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listCronJobs } from "@/lib/cron-jobs";
import { CronJobsEditor } from "@/components/CronJobsEditor";

export default async function AdminCronPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const jobs = await listCronJobs();

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
        immediately and override the migration value until changed again.
      </p>
      <section className="card flex flex-col gap-4">
        <CronJobsEditor jobs={jobs} />
      </section>
    </main>
  );
}

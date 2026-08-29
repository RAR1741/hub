import { withRole } from "@/lib/api";
import { listCronJobs, parseRescheduleInput, rescheduleCronJob } from "@/lib/cron-jobs";

export const GET = withRole("admin", async () => {
  const jobs = await listCronJobs();
  return Response.json({ jobs });
});

export const PATCH = withRole("admin", async (_viewer, request) => {
  const input = parseRescheduleInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await rescheduleCronJob(input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.error ?? "failed" }, { status: result.status });
});

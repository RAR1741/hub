import { withRole } from "@/lib/api";
import { getActivePeriod, getPeriod } from "@/lib/periods";
import { hoursReportForPeriod } from "@/lib/reports";
import { hoursReportCsv } from "@/lib/reports-export";

/** GET /api/admin/reports/hours?period=<id> — CSV download, mentor+. Defaults to the active period. */
export const GET = withRole("mentor", async (_viewer, request) => {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("period");
  // A requested-but-nonexistent period is a 404, not a silent empty CSV.
  const period = requested ? await getPeriod(requested) : await getActivePeriod();
  if (!period) {
    return Response.json({ error: "period not found" }, { status: 404 });
  }

  const rows = await hoursReportForPeriod(period.id);
  const csv = hoursReportCsv(rows);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hours-${period.id}.csv"`,
    },
  });
});

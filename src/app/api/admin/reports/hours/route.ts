import { withRole } from "@/lib/api";
import { getActivePeriod } from "@/lib/periods";
import { hoursReportForPeriod } from "@/lib/reports";
import { hoursReportCsv } from "@/lib/reports-export";

/** GET /api/admin/reports/hours?period=<id> — CSV download, mentor+. Defaults to the active period. */
export const GET = withRole("mentor", async (_viewer, request) => {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("period");
  const periodId = requested ?? (await getActivePeriod())?.id;
  if (!periodId) {
    return Response.json({ error: "no active period" }, { status: 404 });
  }

  const rows = await hoursReportForPeriod(periodId);
  const csv = hoursReportCsv(rows);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hours-${periodId}.csv"`,
    },
  });
});

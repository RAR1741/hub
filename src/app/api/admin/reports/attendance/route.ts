import { withRole } from "@/lib/api";
import { attendanceSummaryForPeriod } from "@/lib/attendance";
import { getActivePeriod, getPeriod } from "@/lib/periods";
import { attendanceSummaryCsv } from "@/lib/reports-export";

/** GET /api/admin/reports/attendance?period=<id> — CSV download, mentor+. Defaults to the active period. */
export const GET = withRole("mentor", async (_viewer, request) => {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("period");
  // A requested-but-nonexistent period is a 404, not a silent empty CSV.
  const period = requested ? await getPeriod(requested) : await getActivePeriod();
  if (!period) {
    return Response.json({ error: "period not found" }, { status: 404 });
  }
  const periodId = period.id;

  const rows = await attendanceSummaryForPeriod(periodId);
  const csv = attendanceSummaryCsv(
    rows.map((r) => ({
      name: r.name,
      present: r.present,
      excused: r.excused,
      absent: r.absent,
      requiredDays: r.requiredDays,
      pct: r.percentage,
    })),
  );
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${periodId}.csv"`,
    },
  });
});

import { withRole } from "@/lib/api";
import { dietaryRestrictionsReport } from "@/lib/reports";
import { dietaryRestrictionsCsv } from "@/lib/reports-export";

/** GET /api/admin/reports/dietary — CSV download, mentor+. Active members with dietary restrictions. */
export const GET = withRole("mentor", async () => {
  const rows = await dietaryRestrictionsReport();
  const csv = dietaryRestrictionsCsv(
    rows.map((r) => ({ name: r.name, role: r.role, dietaryRestrictions: r.dietaryRestrictions })),
  );
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dietary-restrictions-${date}.csv"`,
    },
  });
});

import { withRole } from "@/lib/api";
import { generateSeasonPeriodsForYear } from "@/lib/periods";

export const POST = withRole("admin", async (_viewer, request) => {
  const body = await request.json().catch(() => null);
  const year = typeof body?.year === "number" ? body.year : Number(body?.year);
  if (!Number.isInteger(year)) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await generateSeasonPeriodsForYear(year);
  return Response.json(result, { status: 201 });
});

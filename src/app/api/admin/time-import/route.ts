import { withRole } from "@/lib/api";
import { runTimeImport } from "@/lib/time-import-run";

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const csv = typeof body?.csv === "string" ? (body.csv as string) : null;
  const periodId = typeof body?.periodId === "string" ? (body.periodId as string) : null;
  if (csv === null || periodId === null) return Response.json({ error: "invalid" }, { status: 400 });
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });

  // Never trust a client preview — runTimeImport re-parses the raw text.
  const result = await runTimeImport({ csv, periodId, importedBy: viewer.person.id });
  if ("error" in result) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 200 });
});

import { withRole } from "@/lib/api";
import { runApplicationImport, type ApplicationDecision } from "@/lib/application-import-run";

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const csv = typeof body?.csv === "string" ? (body.csv as string) : null;
  if (csv === null) return Response.json({ error: "invalid" }, { status: 400 });
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });

  // Writes require an explicit confirm; any bare call is a harmless dry-run preview.
  const confirm = body?.confirm === true;

  // Sanitize the per-anomaly decisions to exactly our allowed values.
  const decisions: Record<string, ApplicationDecision> = {};
  const rawDecisions = body?.decisions;
  if (rawDecisions && typeof rawDecisions === "object") {
    for (const [k, v] of Object.entries(rawDecisions as Record<string, unknown>)) {
      if (v === "create" || v === "skip" || (typeof v === "string" && v.startsWith("link:") && v.length > "link:".length)) {
        decisions[k] = v as ApplicationDecision;
      }
    }
  }

  // Never trust a client preview — runApplicationImport re-parses the raw text
  // and enforces that undecided fuzzy matches block a confirmed write.
  const result = await runApplicationImport({ csvText: csv, dryRun: !confirm, decisions, confirm });
  if ("error" in result) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 200 });
});

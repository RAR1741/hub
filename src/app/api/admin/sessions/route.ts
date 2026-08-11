import { withRole } from "@/lib/api";
import { createManualSession, parseManualSession } from "@/lib/session-edit";
import { getActivePeriod } from "@/lib/periods";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseManualSession(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const period = await getActivePeriod();
  if (!period) return Response.json({ error: "no_active_period" }, { status: 409 });
  const result = await createManualSession(input, viewer.person!.id, period.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

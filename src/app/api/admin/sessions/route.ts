import { withRole } from "@/lib/api";
import { createManualSession, parseManualSession } from "@/lib/session-edit";
import { getActivePeriod } from "@/lib/periods";
import { broadcast } from "@/lib/realtime";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseManualSession(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const period = await getActivePeriod();
  if (!period) return Response.json({ error: "no_active_period" }, { status: 409 });
  const result = await createManualSession(input, viewer.person!.id, period.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  await broadcast("hub:presence", "session-edit");
  return Response.json({ ok: true });
});

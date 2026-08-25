import { withRole } from "@/lib/api";
import { revokeBadgeAward } from "@/lib/badges";

type Ctx = { params: Promise<{ id: string; badgeId: string }> };

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id, badgeId } = await context.params;
  const result = await revokeBadgeAward(badgeId, id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

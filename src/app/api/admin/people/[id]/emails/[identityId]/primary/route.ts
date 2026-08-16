import { withRole } from "@/lib/api";
import { makePrimaryIdentity } from "@/lib/identities";

type Ctx = { params: Promise<{ id: string; identityId: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id, identityId } = await context.params;
  const result = await makePrimaryIdentity(id, identityId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

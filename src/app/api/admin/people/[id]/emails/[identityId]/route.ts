import { withRole } from "@/lib/api";
import { removePersonIdentity } from "@/lib/identities";

type Ctx = { params: Promise<{ id: string; identityId: string }> };

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id, identityId } = await context.params;
  const result = await removePersonIdentity(id, identityId);
  if (!result.ok) {
    return Response.json(
      { error: result.reason ?? "failed" },
      { status: result.status },
    );
  }
  return Response.json({ ok: true });
});

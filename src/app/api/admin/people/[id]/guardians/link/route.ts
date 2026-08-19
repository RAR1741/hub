import { withRole } from "@/lib/api";
import { linkGuardian, parseRelationship } from "@/lib/guardians";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const guardianId = reqUuid(body?.guardianId);
  const relationship = parseRelationship(body?.relationship);
  if (!guardianId || !relationship) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await linkGuardian(id, guardianId, relationship.value);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

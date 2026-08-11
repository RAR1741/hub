import { withRole } from "@/lib/api";
import { removeMember, upsertMember } from "@/lib/teams";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  const isManager = typeof body?.isManager === "boolean" ? body.isManager : false;
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await upsertMember(id, personId, isManager);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await removeMember(id, personId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

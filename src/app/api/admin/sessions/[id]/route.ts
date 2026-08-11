import { withRole } from "@/lib/api";
import { deleteSession, parseSessionEdit, updateSession } from "@/lib/session-edit";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id } = await context.params;
  const edit = parseSessionEdit(await request.json().catch(() => null));
  if (!edit) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateSession(id, edit, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteSession(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

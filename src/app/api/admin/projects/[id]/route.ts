import { withRole } from "@/lib/api";
import { deleteProject, parseProjectInput, updateProject } from "@/lib/parts";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parseProjectInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateProject(id, input);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteProject(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

import { withRole } from "@/lib/api";
import { deleteForm, getFormWithFields, parseFormInput, updateForm } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const data = await getFormWithFields(id);
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(data);
});

export const PATCH = withRole<Ctx>("mentor", async (_v, request, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const parsed = parseFormInput(await request.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateForm(id, { title: parsed.title, description: parsed.description, status: parsed.status });
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const id = reqUuid((await ctx.params).id);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteForm(id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

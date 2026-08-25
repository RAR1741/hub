import { withRole } from "@/lib/api";
import { addField, parseFieldInput } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (_v, request, ctx) => {
  const formId = reqUuid((await ctx.params).id);
  if (!formId) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parseFieldInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await addField(formId, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

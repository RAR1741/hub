import { withRole } from "@/lib/api";
import { deleteField } from "@/lib/forms";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ fieldId: string }> };

export const DELETE = withRole<Ctx>("mentor", async (_v, _r, ctx) => {
  const fieldId = reqUuid((await ctx.params).fieldId);
  if (!fieldId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteField(fieldId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

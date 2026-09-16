import { withRole } from "@/lib/api";
import { deleteUsage } from "@/lib/batteries";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteUsage(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

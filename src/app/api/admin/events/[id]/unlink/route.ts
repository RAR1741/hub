import { withRole } from "@/lib/api";
import { unlinkEvent } from "@/lib/events";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await unlinkEvent(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

import { withRole } from "@/lib/api";
import { deletePart, parsePartPatch, updatePart } from "@/lib/parts";
import { broadcast } from "@/lib/realtime";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("student", async (_viewer, request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const patch = parsePartPatch(await request.json().catch(() => null));
  if (!patch) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updatePart(id, patch);
  if (result.ok) await broadcast("hub:parts", "part-update");
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("student", async (_viewer, _request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deletePart(id);
  if (result.ok) await broadcast("hub:parts", "part-delete");
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

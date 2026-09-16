import { withRole } from "@/lib/api";
import { parseBatteryInput, updateBattery } from "@/lib/batteries";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  if (!id) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parseBatteryInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateBattery(id, input);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

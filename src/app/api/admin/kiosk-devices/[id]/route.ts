import { withRole } from "@/lib/api";
import { deleteKioskDevice } from "@/lib/kiosk";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteKioskDevice(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

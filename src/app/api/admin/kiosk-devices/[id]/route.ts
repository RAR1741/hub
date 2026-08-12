import { withRole } from "@/lib/api";
import { deleteKioskDevice, renameKioskDevice } from "@/lib/kiosk";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = reqString(body?.name, 80);
  if (!name) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await renameKioskDevice(id, name);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteKioskDevice(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

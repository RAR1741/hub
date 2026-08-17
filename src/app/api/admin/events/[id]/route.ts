import { withRole } from "@/lib/api";
import { deleteEvent, parseEventInput, updateEvent } from "@/lib/events";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("mentor", async (_viewer, request, context) => {
  const { id } = await context.params;
  const input = parseEventInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateEvent(id, input);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteEvent(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

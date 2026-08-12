import { withRole } from "@/lib/api";
import { deleteMeeting, parseMeetingInput, updateMeeting } from "@/lib/meetings";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const input = parseMeetingInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateMeeting(id, input);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteMeeting(id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

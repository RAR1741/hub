import { withRole } from "@/lib/api";
import { setEventPersonNote } from "@/lib/event-signups";
import { optString, reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id: rawId } = await context.params;
  const id = reqUuid(rawId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = body ? reqUuid(body.personId) : null;
  const note = body ? optString(body.note, 500) : null;
  if (!id || !personId || !note) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setEventPersonNote(id, personId, note.value, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

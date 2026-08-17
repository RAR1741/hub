import { withRole } from "@/lib/api";
import { checkInPerson, uncheckIn } from "@/lib/event-signups";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = body ? reqString(body.personId, 64) : null;
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await checkInPerson(id, personId, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true }, { status: 201 })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole<Ctx>("mentor", async (_viewer, request) => {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await uncheckIn(sessionId);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: "failed" }, { status: result.status });
});

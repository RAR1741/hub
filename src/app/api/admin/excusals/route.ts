import { withRole } from "@/lib/api";
import { createExcusal, deleteExcusal, parseExcusalInput } from "@/lib/excusals";
import { reqString } from "@/lib/validate";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseExcusalInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createExcusal(input, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

export const DELETE = withRole("mentor", async (_viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  const date = typeof body?.date === "string" ? body.date : null;
  if (!personId || !date) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await deleteExcusal(personId, date);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

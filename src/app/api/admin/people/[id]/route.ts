import { withRole } from "@/lib/api";
import { parsePersonInput, updatePerson } from "@/lib/people";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const input = parsePersonInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updatePerson(id, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

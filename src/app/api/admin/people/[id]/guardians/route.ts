import { withRole } from "@/lib/api";
import { createGuardianForPerson, parseGuardianInput, parseRelationship } from "@/lib/guardians";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseGuardianInput(body);
  const relationship = parseRelationship(body?.relationship);
  if (!input || !relationship) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createGuardianForPerson(id, input, relationship.value);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

import { withRole } from "@/lib/api";
import { deleteGuardian, parseGuardianInput, updateGuardian } from "@/lib/guardians";

type Ctx = { params: Promise<{ guardianId: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { guardianId } = await context.params;
  const body = await request.json().catch(() => null);
  const input = parseGuardianInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateGuardian(guardianId, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

// Deletes the guardian entirely, cascading every person_guardian link.
export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { guardianId } = await context.params;
  const result = await deleteGuardian(guardianId);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

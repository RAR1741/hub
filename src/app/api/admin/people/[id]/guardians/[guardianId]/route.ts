import { withRole } from "@/lib/api";
import { unlinkGuardian } from "@/lib/guardians";

type Ctx = { params: Promise<{ id: string; guardianId: string }> };

// Unlinks a guardian from this student only — does not delete the guardian record.
export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id, guardianId } = await context.params;
  const result = await unlinkGuardian(id, guardianId);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

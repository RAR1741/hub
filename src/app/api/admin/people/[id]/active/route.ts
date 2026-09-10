import { withRole } from "@/lib/api";
import { setPersonActive } from "@/lib/people";

type Ctx = { params: Promise<{ id: string }> };

// Toggle a person's active flag without touching the rest of the row. Admin-only.
export const PUT = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.active !== "boolean") return Response.json({ error: "invalid" }, { status: 400 });
  const result = await setPersonActive(id, body.active);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.status === 404 ? "not_found" : "failed" }, { status: result.status });
});

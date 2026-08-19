import { withRole } from "@/lib/api";
import { deleteBadge, parseBadgeInput, updateBadge } from "@/lib/badges";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const input = parseBadgeInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateBadge(id, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteBadge(id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

import { withRole } from "@/lib/api";
import { applyToTeam } from "@/lib/teams";
import { optString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("student", async (viewer, request, context) => {
  if (!viewer.person) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = optString(body?.message, 500);
  if (!message) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await applyToTeam(id, viewer.person.id, message.value);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

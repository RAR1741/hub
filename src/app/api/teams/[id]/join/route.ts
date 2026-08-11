import { withRole } from "@/lib/api";
import { joinTeam } from "@/lib/teams";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("student", async (viewer, _request, context) => {
  if (!viewer.person) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const result = await joinTeam(id, viewer.person.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

import { withRole } from "@/lib/api";
import { awardBadge, canAwardBadge, getBadge, parseAwardBadgeInput } from "@/lib/badges";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("student", async (viewer, request, context) => {
  if (!viewer.person) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;

  const input = parseAwardBadgeInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });

  const badge = await getBadge(input.badgeId);
  if (!badge) return Response.json({ error: "not_found" }, { status: 404 });

  if (!canAwardBadge(viewer.role, viewer.person.id, id, badge)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await awardBadge(badge.id, id, viewer.person.id, input.note);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true }, { status: 201 });
});

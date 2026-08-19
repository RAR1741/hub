import { withRole } from "@/lib/api";
import { createBadge, parseBadgeInput } from "@/lib/badges";

export const POST = withRole("admin", async (viewer, request) => {
  const input = parseBadgeInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createBadge(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

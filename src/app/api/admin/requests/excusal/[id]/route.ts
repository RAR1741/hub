import { withRole } from "@/lib/api";
import { reviewExcusalRequest } from "@/lib/excusal-requests";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("mentor", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "approve" && action !== "deny") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const result = await reviewExcusalRequest(id, action, viewer.person!.id);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: "failed" }, { status: result.status });
});

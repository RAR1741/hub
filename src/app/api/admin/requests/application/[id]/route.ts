import { withRole } from "@/lib/api";
import { approveApplication, denyApplication } from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const reviewerId = viewer.person!.id;

  if (body?.action === "approve") {
    const result = await approveApplication(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  if (body?.action === "deny") {
    const result = await denyApplication(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  return Response.json({ error: "invalid" }, { status: 400 });
});

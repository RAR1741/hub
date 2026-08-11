import { withRole } from "@/lib/api";
import {
  approveAccountRequest,
  denyAccountRequest,
  parseApproval,
} from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const reviewerId = viewer.person!.id;

  if (body?.action === "deny") {
    const result = await denyAccountRequest(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  if (body?.action === "approve") {
    const approval = parseApproval(body);
    if (!approval) return Response.json({ error: "invalid" }, { status: 400 });
    const result = await approveAccountRequest(id, approval, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  return Response.json({ error: "invalid" }, { status: 400 });
});

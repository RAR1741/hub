import { withRole } from "@/lib/api";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { createToolDeleteRequest, parseToolDeleteRequestInput } from "@/lib/tool-delete-requests";

const toolDeleteRequestLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export const POST = withRole("student", async (viewer, request) => {
  if (!toolDeleteRequestLimiter.check(clientIp(request))) {
    return Response.json({ ok: false }, { status: 429 });
  }
  if (!viewer.person) return Response.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseToolDeleteRequestInput(body);
  if (!input) return Response.json({ ok: false }, { status: 400 });

  // requested_by is ALWAYS the viewer's own id — never read from the body.
  const result = await createToolDeleteRequest(viewer.person.id, input);
  if (!result.ok) return Response.json({ ok: false }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

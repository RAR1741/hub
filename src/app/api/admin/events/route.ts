import { withRole } from "@/lib/api";
import { createEvent, parseEventInput } from "@/lib/events";

export const POST = withRole("mentor", async (viewer, request) => {
  const input = parseEventInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createEvent(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

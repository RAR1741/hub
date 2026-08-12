import { withRole } from "@/lib/api";
import { createManualMeeting, parseMeetingInput } from "@/lib/meetings";

export const POST = withRole("admin", async (_viewer, request) => {
  const input = parseMeetingInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createManualMeeting(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

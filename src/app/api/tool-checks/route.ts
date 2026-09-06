import { withRole } from "@/lib/api";
import { createCheck, parseCheckInput } from "@/lib/tools";

export const POST = withRole("student", async (viewer, request) => {
  const input = parseCheckInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createCheck(input, viewer.person!.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

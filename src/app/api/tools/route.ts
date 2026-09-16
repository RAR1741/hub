import { withRole } from "@/lib/api";
import { createTool, parseToolInput } from "@/lib/tools";

export const POST = withRole("student", async (viewer, request) => {
  const input = parseToolInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createTool(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

import { withRole } from "@/lib/api";
import { createProject, parseProjectInput } from "@/lib/parts";

export const POST = withRole("mentor", async (_viewer, request) => {
  const input = parseProjectInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createProject(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});

import { withRole } from "@/lib/api";
import { createPart, getProject, parseOnshapePartInput } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";

export const POST = withRole("student", async (_viewer, request) => {
  const input = parseOnshapePartInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPart(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  const project = await getProject(input.projectId);
  const number = project
    ? fullPartNumber(project.partNumberPrefix, input.type, result.partNumber)
    : String(result.partNumber);
  return Response.json({ id: result.id, fullPartNumber: number }, { status: 201 });
});

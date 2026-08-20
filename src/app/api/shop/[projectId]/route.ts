import { withRole } from "@/lib/api";
import { getProject, listParts } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = withRole<Ctx>("student", async (_viewer, _request, context) => {
  const { projectId: rawProjectId } = await context.params;
  const projectId = reqUuid(rawProjectId);
  if (!projectId) return Response.json({ error: "not_found" }, { status: 404 });
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  const parts = await listParts(projectId);
  return Response.json({
    project: { id: project.id, name: project.name },
    parts: parts.map((p) => ({
      id: p.id,
      fullPartNumber: fullPartNumber(project.partNumberPrefix, p.type, p.partNumber),
      partNumber: p.partNumber,
      type: p.type,
      name: p.name,
      status: p.status,
      priority: p.priority,
    })),
  });
});

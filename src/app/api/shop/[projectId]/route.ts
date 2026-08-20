import { getViewer } from "@/lib/viewer";
import { getProject, listParts } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";
import { reqUuid } from "@/lib/validate";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Ctx) {
  // Public: shop-floor TV can't OAuth. No role check (whos-here pattern).
  await getViewer();
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
}

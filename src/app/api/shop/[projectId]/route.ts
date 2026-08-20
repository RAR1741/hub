import { getViewer } from "@/lib/viewer";
import { getProject, listParts } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Ctx) {
  // Public: shop-floor TV can't OAuth. No role check (whos-here pattern).
  await getViewer();
  const { projectId } = await context.params;
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  const parts = await listParts(projectId);
  return Response.json({
    project: { id: project.id, name: project.name },
    parts: parts.map((p) => ({
      id: p.id,
      fullPartNumber: fullPartNumber(project.partNumberPrefix, p.type, p.partNumber),
      type: p.type,
      name: p.name,
      status: p.status,
      priority: p.priority,
    })),
  });
}

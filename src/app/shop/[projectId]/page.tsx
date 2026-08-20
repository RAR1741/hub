import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, listParts } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";
import { ShopBoard } from "@/components/ShopBoard";

type Params = { params: Promise<{ projectId: string }> };

// Public: server shell (name + back link) renders the initial parts list
// server-side (matches the WhosHere pattern) — the client board then polls
// the public /api/shop/[projectId] route for refreshes.
export default async function ShopBoardPage({ params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();
  const parts = await listParts(projectId);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <Link href="/shop" className="sub">
            ← All projects
          </Link>
          <h1>{project.name}</h1>
        </div>
      </div>
      <ShopBoard
        projectId={project.id}
        initial={parts.map((p) => ({
          id: p.id,
          fullPartNumber: fullPartNumber(project.partNumberPrefix, p.type, p.partNumber),
          partNumber: p.partNumber,
          type: p.type,
          name: p.name,
          status: p.status,
          priority: p.priority,
        }))}
      />
    </main>
  );
}

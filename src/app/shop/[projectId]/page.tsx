import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { getProject, listParts } from "@/lib/parts";
import { fullPartNumber } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { ShopBoard } from "@/components/ShopBoard";

type Params = { params: Promise<{ projectId: string }> };

// Student+: server shell (name + back link) renders the initial parts list
// server-side (matches the WhosHere pattern) — the client board then polls
// the student+ /api/shop/[projectId] route for refreshes.
export default async function ShopBoardPage({ params }: Params) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "student")) redirect("/login");

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
        <Link href={`/admin/projects/${project.id}`} className="btn btn-secondary">
          Manage / add parts
        </Link>
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

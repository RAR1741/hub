import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { hasRole } from "@/lib/authz";
import { getPart, getProject, listParts, partAncestors } from "@/lib/parts";
import { getViewer } from "@/lib/viewer";
import { fullPartNumber, PRIORITY_MAP, STATUS_MAP } from "@/lib/types";
import { DeletePartButton } from "@/components/DeletePartButton";
import { PartEditForm } from "@/components/PartEditForm";
import { PartsTable } from "@/components/PartsTable";

export default async function PartDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const { edit } = await searchParams;
  const part = await getPart(id);
  if (!part) notFound();

  const [project, allParts] = await Promise.all([getProject(part.projectId), listParts(part.projectId)]);
  if (!project) notFound();

  const ancestors = partAncestors(part, allParts);
  const children = allParts.filter((p) => p.parentPartId === part.id);
  const fullNumber = fullPartNumber(project.partNumberPrefix, part.type, part.partNumber);

  return (
    <main className="flex flex-col gap-6">
      <nav className="sub">
        <Link href={`/admin/projects/${project.id}`}>{project.name}</Link>
        {ancestors.map((a) => (
          <span key={a.id}> › <Link href={`/admin/parts/${a.id}`}>{fullPartNumber(project.partNumberPrefix, a.type, a.partNumber)}</Link></span>
        ))}
        <span> › {fullNumber}</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="mono">{fullNumber}</h1>
          <div className="sub">{part.name}</div>
        </div>
        <Link href={`/admin/parts/${id}?edit=1`} className="btn btn-secondary">Edit</Link>
      </div>

      <details className="card" open={edit === "1"}>
        <summary className="cursor-pointer font-semibold">Edit part</summary>
        <div className="mt-4">
          <PartEditForm part={part} />
        </div>
      </details>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <tbody>
              <tr><th>Full number</th><td className="mono">{fullNumber}</td></tr>
              <tr><th>Type</th><td>{part.type}</td></tr>
              <tr><th>Name</th><td>{part.name}</td></tr>
              <tr><th>Status</th><td>{STATUS_MAP[part.status]}</td></tr>
              <tr><th>Notes</th><td>{part.notes ?? ""}</td></tr>
              {part.type === "part" && (
                <>
                  <tr><th>Priority</th><td>{PRIORITY_MAP[part.priority]}</td></tr>
                  <tr><th>Source material</th><td>{part.sourceMaterial ?? ""}</td></tr>
                  <tr><th>Have material</th><td>{part.haveMaterial ? "Yes" : "No"}</td></tr>
                  <tr><th>Quantity</th><td>{part.quantity ?? ""}</td></tr>
                  <tr><th>Cut length</th><td>{part.cutLength ?? ""}</td></tr>
                  <tr><th>Drawing created</th><td>{part.drawingCreated ? "Yes" : "No"}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {part.type === "assembly" && (
        <>
          <h2>Children</h2>
          <PartsTable parts={children} projectPrefix={project.partNumberPrefix} />
        </>
      )}

      <DeletePartButton partId={id} projectId={project.id} parentPartId={part.parentPartId} />
    </main>
  );
}

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { hasRole } from "@/lib/authz";
import { getProject, listParts, sortParts } from "@/lib/parts";
import type { PartSortKey } from "@/lib/parts";
import { getViewer } from "@/lib/viewer";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { PartForm } from "@/components/PartForm";
import { PartsTable } from "@/components/PartsTable";
import { ProjectForm } from "@/components/ProjectForm";

const SORT_KEYS: PartSortKey[] = ["number", "type", "name", "parent", "status"];

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; sort?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const { id } = await params;
  const { edit, sort } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  const sortKey: PartSortKey = (SORT_KEYS as string[]).includes(sort ?? "") ? (sort as PartSortKey) : "number";
  const parts = sortParts(await listParts(id), sortKey);
  const assemblies = parts.filter((p) => p.type === "assembly");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <div className="sub mono">{project.partNumberPrefix}</div>
        </div>
        <div className="flex gap-2">
          <Link href={`/shop/${id}`} className="btn btn-secondary">Board</Link>
          <Link href={`/admin/projects/${id}?edit=1`} className="btn btn-secondary">Edit</Link>
        </div>
      </div>

      <details className="card" open={edit === "1"}>
        <summary className="cursor-pointer font-semibold">Edit project</summary>
        <div className="mt-4">
          <ProjectForm project={project} />
        </div>
      </details>

      <div className="flex gap-3 text-sm">
        <span className="text-[var(--muted)]">Sort:</span>
        {SORT_KEYS.map((k) => (
          <Link
            key={k}
            href={`/admin/projects/${id}?sort=${k}`}
            className={k === sortKey ? "font-semibold" : "text-[var(--muted)]"}
          >
            {k}
          </Link>
        ))}
      </div>

      <PartsTable parts={parts} projectPrefix={project.partNumberPrefix} />

      <details className="card">
        <summary className="cursor-pointer font-semibold">New part</summary>
        <div className="mt-4">
          <PartForm projectId={id} assemblies={assemblies} />
        </div>
      </details>

      <DeleteProjectButton projectId={id} />
    </main>
  );
}

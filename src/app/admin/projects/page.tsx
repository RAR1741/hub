import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { countPartsByProject, listProjects } from "@/lib/parts";
import { getViewer } from "@/lib/viewer";
import { ProjectForm } from "@/components/ProjectForm";

export default async function AdminProjectsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const projects = await listProjects();
  const counts = await countPartsByProject();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Part numbering, assemblies, shop dashboard.</div>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">New project</summary>
        <div className="mt-4">
          <ProjectForm />
        </div>
      </details>

      {projects.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No projects yet.</p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Parts</th><th></th></tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/admin/projects/${p.id}`}>{p.name}</Link></td>
                    <td className="mono">{p.partNumberPrefix}</td>
                    <td>{counts[p.id] ?? 0}</td>
                    <td className="flex gap-2">
                      <Link href={`/shop/${p.id}`} className="btn btn-secondary px-3 py-1">Board</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/authz";
import { listForms } from "@/lib/forms";
import { getViewer } from "@/lib/viewer";
import { CreateFormForm } from "@/components/FormFieldEditor";

export default async function AdminFormsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const forms = await listForms();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Forms</h1>
          <div className="sub">Sign-up forms attachable to events.</div>
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">New form</summary>
        <div className="mt-4">
          <CreateFormForm />
        </div>
      </details>

      <div className="tablewrap">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Title</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id}>
                  <td>{f.title}</td>
                  <td className="mono">{f.status}</td>
                  <td><Link href={`/admin/forms/${f.id}`} className="btn btn-secondary px-3 py-1">Edit</Link></td>
                </tr>
              ))}
              {forms.length === 0 && (
                <tr><td colSpan={3} className="text-sm text-[var(--muted)]">No forms yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

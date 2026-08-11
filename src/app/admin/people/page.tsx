import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";

export default async function AdminPeoplePage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const rows = await listPeople();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin — People</h1>
      <section className="card flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Create person</h2>
        <PersonForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">All people ({rows.length})</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Student ID</th><th>Email</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.display_name ?? `${r.first_name} ${r.last_name}`}</td>
                  <td><span className="badge">{r.role}</span></td>
                  <td>{r.student_id_number ?? ""}</td>
                  <td>{r.email ?? ""}</td>
                  <td><span className="badge">{r.is_active ? "active" : "inactive"}</span></td>
                  <td><Link href={`/admin/people/${r.id}`} className="font-medium text-[var(--color-brand)]">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

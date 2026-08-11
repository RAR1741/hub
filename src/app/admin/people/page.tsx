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
    <main>
      <h1>Admin — People</h1>
      <h2>Create person</h2>
      <PersonForm />
      <h2>All people ({rows.length})</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>Student ID</th><th>Email</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.display_name ?? `${r.first_name} ${r.last_name}`}</td>
              <td>{r.role}</td>
              <td>{r.student_id_number ?? ""}</td>
              <td>{r.email ?? ""}</td>
              <td>{r.is_active ? "yes" : "no"}</td>
              <td><Link href={`/admin/people/${r.id}`}>Edit</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

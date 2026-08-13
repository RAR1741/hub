import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { RosterImportForm } from "@/components/RosterImportForm";

export default async function AdminPeopleImportPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const rows = await listPeople();
  const existing = rows.map((r) => ({
    email: r.email,
    studentIdNumber: r.student_id_number,
  }));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Import roster</h1>
          <div className="sub">Bulk create or update people from a CSV — matched by email or student ID</div>
        </div>
      </div>
      <RosterImportForm existing={existing} />
    </main>
  );
}

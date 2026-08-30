import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { personFromRow } from "@/lib/types";
import { PeopleBrowser, type PeopleRow } from "@/components/PeopleBrowser";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const viewer = await getViewer();
  // People is mentor+ only — students and guests are redirected to login.
  if (!hasRole(viewer.role, "mentor")) redirect("/login");

  // Fetch the full roster (active + inactive); search and the inactive filter
  // are applied live on the client, so no server-side query params here.
  const rows = await listPeople();
  const people: PeopleRow[] = rows.map(personFromRow).map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    role: p.role,
    isActive: p.isActive,
    studentIdNumber: p.studentIdNumber,
  }));
  const activeCount = people.filter((p) => p.isActive).length;
  // People are edited from /admin/people, which is admin-gated.
  const canEdit = hasRole(viewer.role, "admin");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <div className="sub">
            Roster · {activeCount} active member{activeCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <PeopleBrowser people={people} canEdit={canEdit} />
    </main>
  );
}

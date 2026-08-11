import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getPersonWithTeams } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";

export default async function AdminEditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const result = await getPersonWithTeams(id);
  if (!result) notFound();
  const p = result.person;

  return (
    <main>
      <h1>Edit — {p.displayName ?? `${p.firstName} ${p.lastName}`}</h1>
      <PersonForm
        personId={p.id}
        initial={{
          firstName: p.firstName,
          lastName: p.lastName,
          displayName: p.displayName ?? "",
          role: p.role,
          gradYear: p.gradYear?.toString() ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
          shirtSize: p.shirtSize ?? "",
          dietaryRestrictions: p.dietaryRestrictions ?? "",
          bio: p.bio ?? "",
          studentIdNumber: p.studentIdNumber ?? "",
          isActive: p.isActive,
        }}
      />
    </main>
  );
}

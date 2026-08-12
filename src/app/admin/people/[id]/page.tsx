import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getPersonWithTeams } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";
import { DeletePersonButton } from "@/components/DeletePersonButton";

export default async function AdminEditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const result = await getPersonWithTeams(id);
  if (!result) notFound();
  const p = result.person;
  const name = p.displayName ?? `${p.firstName} ${p.lastName}`;

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Edit — {name}</h1>
          <div className="sub">Person details</div>
        </div>
        <DeletePersonButton personId={p.id} name={name} labeled />
      </div>
      <section className="card flex flex-col gap-4">
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
      </section>
    </main>
  );
}

import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getPersonWithTeams } from "@/lib/people";
import { listPersonIdentities } from "@/lib/identities";
import { getGuardiansForPerson } from "@/lib/guardians";
import { PersonForm } from "@/components/PersonForm";
import { DeletePersonButton } from "@/components/DeletePersonButton";
import { PersonEmails } from "@/components/PersonEmails";
import { PersonSlackLink } from "@/components/PersonSlackLink";
import { PersonGuardians } from "@/components/PersonGuardians";

export default async function AdminEditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [result, identities, guardians] = await Promise.all([
    getPersonWithTeams(id),
    listPersonIdentities(id),
    getGuardiansForPerson(id),
  ]);
  if (!result) notFound();
  const p = result.person;
  const name = `${p.firstName} ${p.lastName}`;

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
            dateOfBirth: p.dateOfBirth ?? "",
            streetAddress: p.streetAddress ?? "",
            city: p.city ?? "",
            zip: p.zip ?? "",
            homePhone: p.homePhone ?? "",
            school: p.school ?? "",
            ethnicity: p.ethnicity ?? "",
            race: p.race ?? "",
            interests: (p.interests ?? []).join(", "),
          }}
        />
      </section>
      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sign-in emails</h2>
        <p className="text-sm text-[var(--muted)]">
          Any of these Google accounts signs in as {name}. The primary email is
          what shows elsewhere on the site (it&rsquo;s the Email field above).
        </p>
        <PersonEmails
          personId={p.id}
          identities={identities.map((i) => ({
            id: i.id,
            email: i.email,
            isPrimary: i.is_primary,
            linked: i.auth_user_id !== null,
          }))}
        />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Slack</h2>
        <PersonSlackLink personId={p.id} slackUserId={p.slackUserId ?? null} />
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">Guardians</h2>
        <PersonGuardians personId={p.id} guardians={guardians} />
      </section>
    </main>
  );
}

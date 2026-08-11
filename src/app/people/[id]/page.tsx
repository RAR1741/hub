import { notFound } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { canViewProfile, getPersonWithTeams } from "@/lib/people";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!canViewProfile(viewer, id)) notFound();

  const result = await getPersonWithTeams(id);
  if (!result) notFound();
  const { person, teams } = result;

  return (
    <main>
      <h1>{person.displayName ?? `${person.firstName} ${person.lastName}`}</h1>
      <dl>
        <dt>Role</dt><dd>{person.role}</dd>
        <dt>Grad year</dt><dd>{person.gradYear ?? "—"}</dd>
        <dt>Email</dt><dd>{person.email ?? "—"}</dd>
        <dt>Phone</dt><dd>{person.phone ?? "—"}</dd>
        <dt>Shirt size</dt><dd>{person.shirtSize ?? "—"}</dd>
        <dt>Dietary restrictions</dt><dd>{person.dietaryRestrictions ?? "—"}</dd>
        <dt>Bio</dt><dd>{person.bio ?? "—"}</dd>
        <dt>Active</dt><dd>{person.isActive ? "yes" : "no"}</dd>
      </dl>
      <h2>Teams</h2>
      {teams.length === 0 ? (
        <p>No team memberships.</p>
      ) : (
        <ul>
          {teams.map(({ team, isManager }) => (
            <li key={team.id}>
              {team.name}
              {isManager ? " (manager)" : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

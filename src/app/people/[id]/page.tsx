import { notFound } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { canViewProfile, getPersonWithTeams } from "@/lib/people";
import { getActivePeriod } from "@/lib/periods";
import { personSessions } from "@/lib/reports";
import { sessionHours, totalHours } from "@/lib/hours";

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
  const activePeriod = await getActivePeriod();
  const sessions = activePeriod ? await personSessions(person.id, activePeriod.id) : [];

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
      <h2>Hours{activePeriod ? ` — ${activePeriod.name}` : ""}</h2>
      <p>Total: <strong>{Math.round(totalHours(sessions) * 100) / 100}</strong> h across {sessions.length} sessions.</p>
      <table>
        <thead><tr><th>In</th><th>Out</th><th>Hours</th><th>Source</th><th>Excluded</th></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.timeIn).toLocaleString()}</td>
              <td>{s.timeOut ? new Date(s.timeOut).toLocaleString() : "— open —"}</td>
              <td>{s.timeOut ? Math.round(sessionHours(s) * 100) / 100 : ""}</td>
              <td>{s.source}</td>
              <td>{s.excludedFromTotals ? "yes" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

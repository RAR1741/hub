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
    <main className="flex flex-col gap-6">
      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {person.displayName ?? `${person.firstName} ${person.lastName}`}
          </h1>
          <span className="badge">{person.role}</span>
          <span className="badge">{person.isActive ? "active" : "inactive"}</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="label mb-0">Grad year</dt>
            <dd>{person.gradYear ?? "—"}</dd>
          </div>
          <div>
            <dt className="label mb-0">Email</dt>
            <dd>{person.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="label mb-0">Phone</dt>
            <dd>{person.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="label mb-0">Shirt size</dt>
            <dd>{person.shirtSize ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label mb-0">Dietary restrictions</dt>
            <dd>{person.dietaryRestrictions ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label mb-0">Bio</dt>
            <dd>{person.bio ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Teams</h2>
        {teams.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">No team memberships.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {teams.map(({ team, isManager }) => (
              <li key={team.id} className="badge">
                {team.name}
                {isManager ? " (manager)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Hours{activePeriod ? ` — ${activePeriod.name}` : ""}
        </h2>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Total:{" "}
          <strong className="text-[var(--color-fg)]">
            {Math.round(totalHours(sessions) * 100) / 100}
          </strong>{" "}
          h across {sessions.length} sessions.
        </p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>In</th>
                <th>Out</th>
                <th>Hours</th>
                <th>Source</th>
                <th>Excluded</th>
              </tr>
            </thead>
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
        </div>
      </section>
    </main>
  );
}

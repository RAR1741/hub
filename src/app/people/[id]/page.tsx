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

  const name = person.displayName ?? `${person.firstName} ${person.lastName}`;
  const totalH = Math.round(totalHours(sessions) * 100) / 100;

  return (
    <main className="flex flex-col gap-6">
      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="avatar" style={{ width: 40, height: 40, minWidth: 40, fontSize: 15 }} aria-hidden="true">
            {name
              .trim()
              .split(/\s+/)
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          <span className={`pill ${person.role === "admin" ? "admin" : "role"}`}>
            {person.role}
          </span>
          <span className={`pill ${person.isActive ? "on" : "off"}`}>
            {person.isActive ? "Active" : "Inactive"}
          </span>
          {person.studentIdNumber && <span className="sid">{person.studentIdNumber}</span>}
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
          <p className="text-sm text-[var(--muted)]">No team memberships.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {teams.map(({ team, isManager }) => (
              <li key={team.id} className="pill role">
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
        <div className="flex flex-wrap items-end gap-6">
          <div className="stat" style={{ padding: 0 }}>
            <div className="eyebrow">Total hours</div>
            <div className="num mono" style={{ marginTop: 4 }}>
              {totalH}
              <small> h</small>
            </div>
          </div>
          <div className="stat" style={{ padding: 0 }}>
            <div className="eyebrow">Sessions</div>
            <div className="num mono" style={{ marginTop: 4 }}>
              {sessions.length}
            </div>
          </div>
        </div>
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
                  <td className="mono">{s.timeOut ? Math.round(sessionHours(s) * 100) / 100 : ""}</td>
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

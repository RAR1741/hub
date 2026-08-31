import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { canViewProfile, getPersonWithTeams } from "@/lib/people";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { personSessions } from "@/lib/reports";
import { sessionHours, totalHours } from "@/lib/hours";
import { listBadgesForPerson, listAwardableBadges } from "@/lib/badges";
import { BadgeAwardPanel } from "@/components/BadgeAwardPanel";
import { RevokeBadgeButton } from "@/components/RevokeBadgeButton";
import { getGuardiansForPerson } from "@/lib/guardians";
import { StatusBadge } from "@/components/FirstStatusTable";
import { getTeamTimezone } from "@/lib/settings";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!canViewProfile(viewer, id)) notFound();
  const canViewGuardians = hasRole(viewer.role, "mentor");
  const canEdit = hasRole(viewer.role, "admin");

  const [result, activePeriod, guardians, teamTz] = await Promise.all([
    getPersonWithTeams(id),
    getActivePeriod(),
    canViewGuardians ? getGuardiansForPerson(id) : Promise.resolve([]),
    getTeamTimezone(),
  ]);
  if (!result) notFound();
  const { person, teams } = result;
  const [sessions, heldBadges, awardable] = await Promise.all([
    activePeriod ? personSessions(person.id, activePeriod.id) : Promise.resolve([]),
    listBadgesForPerson(person.id),
    listAwardableBadges(person.id, viewer.role, viewer.person!.id),
  ]);

  const name = `${person.firstName} ${person.lastName}`;
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
          {canEdit && (
            <Link href={`/admin/people/${person.id}`} className="btn ml-auto">
              Edit
            </Link>
          )}
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

      {person.role !== "student" &&
        (hasRole(viewer.role, "admin") || viewer.person?.id === person.id) && (
          <section className="card flex flex-col gap-3">
            <h2 className="text-lg font-semibold">FIRST status</h2>
            {person.firstPeopleId == null ? (
              <p className="text-sm text-[var(--muted)]">
                Not linked to a FIRST roster record yet.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
                <div>
                  <dt className="label mb-0">Consent &amp; Release</dt>
                  <dd><StatusBadge status={person.firstConsentRelease ? "green" : "blue"} label={person.firstConsentRelease ? "Signed" : "Not signed"} /></dd>
                </div>
                <div>
                  <dt className="label mb-0">YPP screening</dt>
                  <dd className="flex flex-col gap-1">
                    <StatusBadge status={person.firstScreeningStatus} />
                    {person.firstScreeningText && person.firstScreeningStatus !== "green" && (
                      <span className="text-sm text-[var(--muted)]">{person.firstScreeningText}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="label mb-0">YPP training</dt>
                  <dd><StatusBadge status={person.firstTrainingStatus} /></dd>
                </div>
                {person.firstSyncedAt && (
                  <div className="sm:col-span-3">
                    <dt className="label mb-0">Last synced</dt>
                    <dd className="text-sm text-[var(--muted)]">{new Date(person.firstSyncedAt).toLocaleString(undefined, { timeZone: teamTz })}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        )}

      {canViewGuardians && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Guardians</h2>
          {guardians.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No guardians on file.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {guardians.map(({ guardian, relationship }) => (
                <li key={guardian.id} className="flex flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {guardian.firstName} {guardian.lastName}
                    </span>
                    {relationship && <span className="pill">{relationship}</span>}
                  </div>
                  {(guardian.email || guardian.phone || guardian.employer) && (
                    <ul className="flex flex-wrap gap-x-4 text-[var(--muted)]">
                      {guardian.email && <li>{guardian.email}</li>}
                      {guardian.phone && <li>{guardian.phone}</li>}
                      {guardian.employer && <li>{guardian.employer}</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Badges</h2>
        {heldBadges.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No badges yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {heldBadges.map((b) => (
              <li key={b.awardId} className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: b.color }}
                  aria-hidden="true"
                />
                <span className="font-medium">{b.name}</span>
                {b.note && <span className="text-sm text-[var(--muted)]">— {b.note}</span>}
                <span className="text-sm text-[var(--muted)]">
                  Awarded by {b.awardedByName} on {new Date(b.awardedAt).toLocaleDateString(undefined, { timeZone: teamTz })}
                </span>
                {hasRole(viewer.role, "mentor") && (
                  <RevokeBadgeButton personId={person.id} badgeId={b.id} />
                )}
              </li>
            ))}
          </ul>
        )}
        <BadgeAwardPanel
          personId={person.id}
          awardable={awardable.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
        />
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
                  <td>{new Date(s.timeIn).toLocaleString(undefined, { timeZone: teamTz })}</td>
                  <td>{s.timeOut ? new Date(s.timeOut).toLocaleString(undefined, { timeZone: teamTz }) : "— open —"}</td>
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

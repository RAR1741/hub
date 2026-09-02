import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getSetting, getTeamTimezone } from "@/lib/settings";
import { listTeams } from "@/lib/teams";
import { listPeople } from "@/lib/people";
import { computeAddRecommendations } from "@/lib/drive-group-sync";
import type { ReconcileResult } from "@/lib/drive-group-sync";
import { SyncNowPanel } from "@/components/SyncNowPanel";
import { ReconcileReport } from "@/components/ReconcileReport";
import { RecommendedMembers } from "@/components/RecommendedMembers";

type IdentityJoin = { email: string };
type MembershipPersonRow = {
  is_active: boolean;
  person_identity: IdentityJoin | IdentityJoin[] | null;
};

/** How many linked identity emails of active members a linked team's group should contain. */
async function expectedCount(teamId: string, db: ReturnType<typeof getDb>): Promise<number> {
  const { data } = await db
    .from("team_membership")
    .select("person (is_active, person_identity (email))")
    .eq("team_id", teamId);
  const rows = (data ?? []) as unknown as { person: MembershipPersonRow | MembershipPersonRow[] | null }[];
  return rows
    .map((r) => (Array.isArray(r.person) ? r.person[0] : r.person))
    .filter((p): p is MembershipPersonRow => !!p && p.is_active)
    .flatMap((p) =>
      Array.isArray(p.person_identity) ? p.person_identity : p.person_identity ? [p.person_identity] : [],
    ).length;
}

export const metadata: Metadata = { title: "Drive Sync" };

export default async function AdminDriveSyncPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const [allTeams, lastReport, people, teamTz] = await Promise.all([
    listTeams(db),
    getSetting<ReconcileResult | null>("drive_last_reconcile", null, db),
    listPeople(undefined, db),
    getTeamTimezone(db),
  ]);

  const linkedTeams = allTeams.filter((t) => t.googleGroupEmail);
  const counts = await Promise.all(linkedTeams.map((t) => expectedCount(t.id, db)));

  // email (lowercase) -> display name, for resolving added/wouldRemove lists.
  const { data: identityRows } = await db
    .from("person_identity")
    .select("email, person (id, is_active, first_name, last_name)");
  const nameByEmail: Record<string, string> = {};
  const personByEmail = new Map<string, { personId: string; name: string; isActive: boolean }>();
  for (const row of (identityRows ?? []) as unknown as {
    email: string;
    person:
      | { id: string; is_active: boolean; first_name: string; last_name: string }
      | { id: string; is_active: boolean; first_name: string; last_name: string }[]
      | null;
  }[]) {
    const p = Array.isArray(row.person) ? row.person[0] : row.person;
    if (!p) continue;
    const name = `${p.first_name} ${p.last_name}`;
    nameByEmail[row.email] = name;
    personByEmail.set(row.email.toLowerCase(), { personId: p.id, name, isActive: p.is_active });
  }

  // The picker for associating an unrecognized email with a person.
  const peoplePicker = people
    .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // teamId -> set of current member personIds, over the linked teams only.
  const linkedTeamIds = linkedTeams.map((t) => t.id);
  const membersByTeam = new Map<string, Set<string>>();
  if (linkedTeamIds.length > 0) {
    const { data: memberRows } = await db
      .from("team_membership")
      .select("team_id, person_id")
      .in("team_id", linkedTeamIds);
    for (const row of (memberRows ?? []) as { team_id: string; person_id: string }[]) {
      const set = membersByTeam.get(row.team_id) ?? new Set<string>();
      set.add(row.person_id);
      membersByTeam.set(row.team_id, set);
    }
  }

  // lowercased group email -> team.
  const groupEmailToTeam = new Map<string, { teamId: string; teamName: string }>();
  for (const t of linkedTeams) {
    if (t.googleGroupEmail) {
      groupEmailToTeam.set(t.googleGroupEmail.toLowerCase(), { teamId: t.id, teamName: t.name });
    }
  }

  const recommendations = lastReport
    ? computeAddRecommendations(lastReport, groupEmailToTeam, personByEmail, membersByTeam)
    : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Drive group sync</h1>
          <div className="sub">Google Group membership for linked teams · {linkedTeams.length} linked</div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <SyncNowPanel endpoint="/api/admin/drive-group/sync" noun="Drive" />
        <p className="text-sm text-[var(--muted)]">
          Reconcile adds missing members. Nobody is removed automatically — review the &ldquo;would be
          removed&rdquo; list below.
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Linked teams</h2>
        {linkedTeams.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No teams have a Google Group linked yet.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Group email</th>
                    <th style={{ textAlign: "right" }}>Expected members</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedTeams.map((t, i) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="mono">{t.googleGroupEmail}</td>
                      <td style={{ textAlign: "right" }}>{counts[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">Last reconcile report</h2>
        {!lastReport ? (
          <p className="text-sm text-[var(--muted)]">No reconcile has run yet.</p>
        ) : (
          <ReconcileReport report={lastReport} nameByEmail={nameByEmail} people={peoplePicker} teamTz={teamTz} />
        )}
      </section>

      {lastReport ? (
        <RecommendedMembers
          teams={recommendations}
          ranAt={lastReport.ranAt}
          teamTz={teamTz}
          description="People with Drive access who are active but not on the team."
        />
      ) : (
        <section className="card flex flex-col gap-2">
          <h2 className="text-base font-semibold">Recommended members</h2>
          <p className="text-sm text-[var(--muted)]">Run a sync first to see recommendations.</p>
        </section>
      )}
    </main>
  );
}

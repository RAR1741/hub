import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getSetting, getTeamTimezone } from "@/lib/settings";
import { listTeams } from "@/lib/teams";
import { listPeople } from "@/lib/people";
import { computeGithubAddRecommendations } from "@/lib/github-team-sync";
import type { GithubReconcileResult } from "@/lib/github-team-sync";
import { SyncNowPanel } from "@/components/SyncNowPanel";
import { GithubReconcileReport } from "@/components/GithubReconcileReport";
import { RecommendedMembers } from "@/components/RecommendedMembers";

export const metadata: Metadata = { title: "GitHub Sync" };

export default async function AdminGithubSyncPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const [allTeams, lastReport, people, teamTz] = await Promise.all([
    listTeams(db),
    getSetting<GithubReconcileResult | null>("github_last_reconcile", null, db),
    listPeople(undefined, db),
    getTeamTimezone(db),
  ]);

  const linkedTeams = allTeams.filter((t) => t.githubTeamSlug);

  // person (lowercased github login) -> display name, for GithubReconcileReport.
  const nameByLogin: Record<string, string> = {};
  const personByGithubId = new Map<number, { personId: string; name: string; isActive: boolean }>();
  for (const p of people) {
    if (p.github_user_id == null) continue;
    const name = `${p.first_name} ${p.last_name}`;
    if (p.github_login) nameByLogin[p.github_login.toLowerCase()] = name;
    personByGithubId.set(p.github_user_id, { personId: p.id, name, isActive: p.is_active });
  }

  // teamId -> set of current member personIds, over the linked teams only.
  const linkedTeamIds = linkedTeams.map((t) => t.id);
  const membersByTeam = new Map<string, Set<string>>();
  if (linkedTeamIds.length > 0) {
    const { data: memberRows, error: memberError } = await db
      .from("team_membership")
      .select("team_id, person_id")
      .in("team_id", linkedTeamIds);
    if (memberError) throw new Error(`list team memberships failed: ${memberError.message}`);
    for (const row of (memberRows ?? []) as { team_id: string; person_id: string }[]) {
      const set = membersByTeam.get(row.team_id) ?? new Set<string>();
      set.add(row.person_id);
      membersByTeam.set(row.team_id, set);
    }
  }

  // Connected/active counts per linked team, from the memberships above.
  const connectedCounts = new Map<string, { connected: number; active: number }>();
  for (const t of linkedTeams) {
    const memberIds = membersByTeam.get(t.id) ?? new Set<string>();
    let connected = 0;
    let active = 0;
    for (const p of people) {
      if (!memberIds.has(p.id) || !p.is_active) continue;
      active++;
      if (p.github_user_id != null) connected++;
    }
    connectedCounts.set(t.id, { connected, active });
  }

  // lowercased team slug -> team.
  const slugToTeam = new Map<string, { teamId: string; teamName: string }>();
  for (const t of linkedTeams) {
    if (t.githubTeamSlug) {
      slugToTeam.set(t.githubTeamSlug.toLowerCase(), { teamId: t.id, teamName: t.name });
    }
  }

  const recommendations = lastReport
    ? computeGithubAddRecommendations(lastReport, slugToTeam, personByGithubId, membersByTeam)
    : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>GitHub team sync</h1>
          <div className="sub">GitHub team membership for linked teams · {linkedTeams.length} linked</div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <SyncNowPanel endpoint="/api/admin/github-team/sync" noun="GitHub team" />
        <p className="text-sm text-[var(--muted)]">
          Reconcile adds missing members. Nobody is removed automatically — review the &ldquo;would be
          removed&rdquo; list below.
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Linked teams</h2>
        {linkedTeams.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No teams have a GitHub team linked yet.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Slug</th>
                    <th style={{ textAlign: "right" }}>Connected / active</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedTeams.map((t) => {
                    const counts = connectedCounts.get(t.id) ?? { connected: 0, active: 0 };
                    return (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td className="mono">{t.githubTeamSlug}</td>
                        <td style={{ textAlign: "right" }}>
                          {counts.connected} / {counts.active}
                        </td>
                      </tr>
                    );
                  })}
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
          <GithubReconcileReport
            report={lastReport}
            nameByLogin={nameByLogin}
            people={people
              .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}` }))
              .sort((a, b) => a.name.localeCompare(b.name))}
          />
        )}
      </section>

      {lastReport ? (
        <RecommendedMembers
          teams={recommendations}
          ranAt={lastReport.ranAt}
          teamTz={teamTz}
          description="People on the GitHub team who are active but not on the hub team."
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

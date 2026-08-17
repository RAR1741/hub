import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { buildTeamTree, listTeams, teamMemberCounts, type TeamNode } from "@/lib/teams";
import { TeamForm } from "@/components/TeamForm";
import { TeamTreeView } from "@/components/TeamTree";

export default async function AdminTeamsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [teams, counts] = await Promise.all([listTeams(), teamMemberCounts()]);

  function renderNode(n: TeamNode) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/teams/${n.id}`} className="font-medium text-[var(--red)]">
          {n.name}
        </Link>
        <span className="pill role">{n.joinMode}</span>
        <span className="pill role">{counts.get(n.id) ?? 0} members</span>
      </div>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <div className="sub">Sub-teams, join modes, membership · {teams.length} total</div>
        </div>
      </div>
      <details className="card">
        <summary className="cursor-pointer text-base font-semibold">Create team</summary>
        <div className="mt-4">
          <TeamForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
        </div>
      </details>
      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Team tree</h2>
        {teams.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">No teams yet — create the first one above.</p>
        ) : (
          <TeamTreeView roots={buildTeamTree(teams)} renderNode={renderNode} />
        )}
      </section>
    </main>
  );
}

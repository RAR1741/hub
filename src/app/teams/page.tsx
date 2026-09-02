import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import {
  buildTeamTree,
  joinAction,
  listTeams,
  memberTeamIds,
  pendingApplicationTeamIds,
  teamMemberCounts,
  type TeamNode,
} from "@/lib/teams";
import { JoinButtons } from "@/components/JoinButtons";
import { TeamTreeView } from "@/components/TeamTree";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage() {
  const viewer = await getViewer();
  // Teams is signed-in only — guests (the only role below student) are sent to login.
  if (!hasRole(viewer.role, "student")) redirect("/login");
  const [teams, counts] = await Promise.all([listTeams(), teamMemberCounts()]);
  const [memberIds, pendingIds] = viewer.person
    ? await Promise.all([
        memberTeamIds(viewer.person.id),
        pendingApplicationTeamIds(viewer.person.id),
      ])
    : [new Set<string>(), new Set<string>()];

  // Editing/managing a team is admin-only (see /admin/teams/[id] and its API),
  // so only admins get a clickable name that links to the team edit page.
  const canManageTeams = hasRole(viewer.role, "admin");

  function renderNode(n: TeamNode) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {canManageTeams ? (
            <Link href={`/admin/teams/${n.id}`} className="font-medium underline">
              {n.name}
            </Link>
          ) : (
            <strong className="font-medium">{n.name}</strong>
          )}
          <span className="pill role">{counts.get(n.id) ?? 0} members</span>
        </div>
        {n.description ? (
          <span className="team-tree-clamp text-sm" style={{ color: "var(--muted)" }}>
            {n.description}
          </span>
        ) : null}
        {viewer.person && (
          <JoinButtons
            teamId={n.id}
            action={joinAction(n, memberIds.has(n.id), pendingIds.has(n.id))}
          />
        )}
      </>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Teams</h1>
        </div>
        {canManageTeams && (
          <Link href="/admin/teams/new" className="btn btn-primary">New team</Link>
        )}
      </div>
      {!viewer.person && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Sign in to join a team.
        </p>
      )}
      <div className="mx-[calc(50%-50vw)] -mb-6 min-h-0 flex-1 overflow-auto p-4">
        <TeamTreeView roots={buildTeamTree(teams)} renderNode={renderNode} />
      </div>
    </main>
  );
}

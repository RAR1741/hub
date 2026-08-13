import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import {
  buildTeamTree,
  joinAction,
  listTeams,
  memberTeamIds,
  pendingApplicationTeamIds,
  type TeamNode,
} from "@/lib/teams";
import { JoinButtons } from "@/components/JoinButtons";

export default async function TeamsPage() {
  const viewer = await getViewer();
  // Teams is signed-in only — guests (the only role below student) are sent to login.
  if (!hasRole(viewer.role, "student")) redirect("/login");
  const teams = await listTeams();
  const [memberIds, pendingIds] = viewer.person
    ? await Promise.all([
        memberTeamIds(viewer.person.id),
        pendingApplicationTeamIds(viewer.person.id),
      ])
    : [new Set<string>(), new Set<string>()];

  function Tree({ nodes }: { nodes: TeamNode[] }) {
    if (nodes.length === 0) return null;
    return (
      <ul className="flex flex-col gap-2 pl-4">
        {nodes.map((n) => (
          <li key={n.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-medium">{n.name}</strong>
              {n.description ? (
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  — {n.description}
                </span>
              ) : null}
              {viewer.person && (
                <JoinButtons
                  teamId={n.id}
                  action={joinAction(n, memberIds.has(n.id), pendingIds.has(n.id))}
                />
              )}
            </div>
            <Tree nodes={n.children} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Teams</h1>
        </div>
      </div>
      {!viewer.person && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Sign in to join a team.
        </p>
      )}
      <div className="card">
        <Tree nodes={buildTeamTree(teams)} />
      </div>
    </main>
  );
}

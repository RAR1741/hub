import { getViewer } from "@/lib/viewer";
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
                <span className="text-sm text-[var(--color-muted-fg)]">
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
      <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
      {!viewer.person && (
        <p className="text-sm text-[var(--color-muted-fg)]">Sign in to join a team.</p>
      )}
      <div className="card">
        <Tree nodes={buildTeamTree(teams)} />
      </div>
    </main>
  );
}

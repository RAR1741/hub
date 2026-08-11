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
      <ul>
        {nodes.map((n) => (
          <li key={n.id}>
            <strong>{n.name}</strong>
            {n.description ? ` — ${n.description}` : ""}{" "}
            {viewer.person && (
              <JoinButtons
                teamId={n.id}
                action={joinAction(n, memberIds.has(n.id), pendingIds.has(n.id))}
              />
            )}
            <Tree nodes={n.children} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main>
      <h1>Teams</h1>
      {!viewer.person && <p>Sign in to join a team.</p>}
      <Tree nodes={buildTeamTree(teams)} />
    </main>
  );
}

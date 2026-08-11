import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { buildTeamTree, listTeams, type TeamNode } from "@/lib/teams";
import { TeamForm } from "@/components/TeamForm";

function Tree({ nodes }: { nodes: TeamNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/admin/teams/${n.id}`}>{n.name}</Link> — {n.joinMode}
          <Tree nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

export default async function AdminTeamsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const teams = await listTeams();
  return (
    <main>
      <h1>Admin — Teams</h1>
      <h2>Create team</h2>
      <TeamForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      <h2>Team tree</h2>
      <Tree nodes={buildTeamTree(teams)} />
    </main>
  );
}

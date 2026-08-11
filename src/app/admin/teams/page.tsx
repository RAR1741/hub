import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { buildTeamTree, listTeams, type TeamNode } from "@/lib/teams";
import { TeamForm } from "@/components/TeamForm";

function Tree({ nodes }: { nodes: TeamNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 pl-4">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/admin/teams/${n.id}`} className="font-medium text-[var(--color-brand)]">
            {n.name}
          </Link>{" "}
          — {n.joinMode}
          <Tree nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

export default async function AdminTeamsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const teams = await listTeams();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin — Teams</h1>
      <section className="card flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Create team</h2>
        <TeamForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </section>
      <section className="card flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Team tree</h2>
        <Tree nodes={buildTeamTree(teams)} />
      </section>
    </main>
  );
}

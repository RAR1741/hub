import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getTeam, listTeamMembers, listTeams } from "@/lib/teams";
import { listPeople, displayName } from "@/lib/people";
import { TeamForm } from "@/components/TeamForm";
import { MemberManager } from "@/components/MemberManager";
import { DeleteTeamButton } from "@/components/DeleteTeamButton";

export default async function AdminTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const [team, teams, members, everyone] = await Promise.all([
    getTeam(id),
    listTeams(),
    listTeamMembers(id),
    listPeople(),
  ]);
  if (!team) notFound();

  const memberIds = new Set(members.map((m) => m.personId));
  const candidates = everyone
    .filter((p) => p.is_active && !memberIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }));

  return (
    <main>
      <h1>Team — {team.name}</h1>
      <TeamForm
        teamId={team.id}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        initial={{
          name: team.name,
          parentTeamId: team.parentTeamId ?? "",
          description: team.description ?? "",
          joinMode: team.joinMode,
        }}
      />
      <MemberManager teamId={team.id} members={members} candidates={candidates} />
      <DeleteTeamButton teamId={team.id} />
    </main>
  );
}

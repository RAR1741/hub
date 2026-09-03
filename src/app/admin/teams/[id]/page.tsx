import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getTeam, listTeamMembers, listTeams } from "@/lib/teams";
import { listPeople, displayName } from "@/lib/people";
import { listTeamExternalAccounts } from "@/lib/team-external-accounts";
import { TeamForm } from "@/components/TeamForm";
import { MemberManager } from "@/components/MemberManager";
import { ExternalAccountManager } from "@/components/ExternalAccountManager";
import { DeleteTeamButton } from "@/components/DeleteTeamButton";

export const metadata: Metadata = { title: "Manage Team" };

export default async function AdminTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [team, teams, members, everyone, externalAccounts] = await Promise.all([
    getTeam(id),
    listTeams(),
    listTeamMembers(id),
    listPeople(),
    listTeamExternalAccounts(id),
  ]);
  if (!team) notFound();

  const memberIds = new Set(members.map((m) => m.personId));
  const candidates = everyone
    .filter((p) => p.is_active && !memberIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Team — {team.name}</h1>
          <div className="sub">{members.length} member{members.length === 1 ? "" : "s"}</div>
        </div>
        <DeleteTeamButton teamId={team.id} />
      </div>
      <section className="card flex flex-col gap-4">
        <TeamForm
          teamId={team.id}
          teams={teams.map((t) => ({ id: t.id, name: t.name }))}
          initial={{
            name: team.name,
            parentTeamId: team.parentTeamId ?? "",
            description: team.description ?? "",
            joinMode: team.joinMode,
            googleGroupEmail: team.googleGroupEmail ?? "",
            githubTeamSlug: team.githubTeamSlug ?? "",
          }}
        />
      </section>
      <section className="card flex flex-col gap-4">
        <MemberManager teamId={team.id} members={members} candidates={candidates} />
      </section>
      <section className="card flex flex-col gap-4">
        <ExternalAccountManager
          teamId={team.id}
          rows={externalAccounts}
          isLinkedGoogle={!!team.googleGroupEmail}
          isLinkedGithub={!!team.githubTeamSlug}
        />
      </section>
    </main>
  );
}

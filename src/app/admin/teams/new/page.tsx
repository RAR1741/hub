import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listTeams } from "@/lib/teams";
import { TeamForm } from "@/components/TeamForm";

export const metadata: Metadata = { title: "New Team" };

export default async function NewTeamPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const teams = await listTeams();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>New team</h1>
        </div>
      </div>
      <section className="card flex flex-col gap-4">
        <TeamForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </section>
    </main>
  );
}

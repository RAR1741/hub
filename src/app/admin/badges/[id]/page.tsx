import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getBadge } from "@/lib/badges";
import { listTeams } from "@/lib/teams";
import { BadgeForm } from "@/components/BadgeForm";
import { DeleteBadgeButton } from "@/components/DeleteBadgeButton";

export const metadata: Metadata = { title: "Badge" };

export default async function AdminBadgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [badge, teams] = await Promise.all([getBadge(id), listTeams()]);
  if (!badge) notFound();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Badge — {badge.name}</h1>
        </div>
        <DeleteBadgeButton badgeId={badge.id} />
      </div>
      <section className="card flex flex-col gap-4">
        <BadgeForm
          badgeId={badge.id}
          teams={teams.map((t) => ({ id: t.id, name: t.name }))}
          initial={{
            name: badge.name,
            category: badge.category ?? "",
            description: badge.description ?? "",
            color: badge.color,
            teamId: badge.teamId ?? "",
            allowSelfAward: badge.allowSelfAward,
          }}
        />
      </section>
    </main>
  );
}

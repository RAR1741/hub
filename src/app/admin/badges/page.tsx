import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listBadges } from "@/lib/badges";
import { listTeams } from "@/lib/teams";
import { BadgeForm } from "@/components/BadgeForm";

export const metadata: Metadata = { title: "Badges" };

export default async function AdminBadgesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const [badges, teams] = await Promise.all([listBadges(), listTeams()]);
  const teamNames = new Map(teams.map((t) => [t.id, t.name]));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Badges</h1>
          <div className="sub">Credentials and training badges · {badges.length} total</div>
        </div>
      </div>
      <details className="card">
        <summary className="cursor-pointer text-base font-semibold">Create badge</summary>
        <div className="mt-4">
          <BadgeForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
        </div>
      </details>
      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">All badges</h2>
        {badges.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">No badges yet — create the first one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {badges.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: b.color }} />
                <Link href={`/admin/badges/${b.id}`} className="font-medium text-[var(--red)]">
                  {b.name}
                </Link>
                {b.category && <span className="pill role">{b.category}</span>}
                {b.teamId && <span className="pill role">{teamNames.get(b.teamId) ?? "team"}</span>}
                {b.allowSelfAward && <span className="pill role">Self-award</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { listTeams } from "@/lib/teams";
import { listPeople } from "@/lib/people";
import type { ReconcileResult } from "@/lib/drive-group-sync";
import { DriveSyncPanel } from "@/components/DriveSyncPanel";

type MembershipPersonRow = { email: string | null; is_active: boolean };

/** How many active, emailed members a linked team's group should contain. */
async function expectedCount(teamId: string, db: ReturnType<typeof getDb>): Promise<number> {
  const { data } = await db
    .from("team_membership")
    .select("person (email, is_active)")
    .eq("team_id", teamId);
  const rows = (data ?? []) as unknown as { person: MembershipPersonRow | MembershipPersonRow[] | null }[];
  return rows
    .map((r) => (Array.isArray(r.person) ? r.person[0] : r.person))
    .filter((p): p is MembershipPersonRow => !!p && p.is_active && !!p.email).length;
}

export default async function AdminDriveSyncPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const [allTeams, lastReport, people] = await Promise.all([
    listTeams(db),
    getSetting<ReconcileResult | null>("drive_last_reconcile", null, db),
    listPeople(undefined, db),
  ]);

  const linkedTeams = allTeams.filter((t) => t.googleGroupEmail);
  const counts = await Promise.all(linkedTeams.map((t) => expectedCount(t.id, db)));

  // email (lowercase) -> display name, for resolving added/wouldRemove lists.
  const nameByEmail = new Map<string, string>();
  for (const p of people) {
    if (p.email) nameByEmail.set(p.email.toLowerCase(), `${p.first_name} ${p.last_name}`);
  }
  const resolve = (email: string) => nameByEmail.get(email.toLowerCase()) ?? email;

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Drive group sync</h1>
          <div className="sub">Google Group membership for linked teams · {linkedTeams.length} linked</div>
        </div>
      </div>

      <section className="card flex flex-col gap-4">
        <DriveSyncPanel />
        <p className="text-sm text-[var(--muted)]">
          Reconcile adds missing members. Nobody is removed automatically — review the &ldquo;would be
          removed&rdquo; list below.
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Linked teams</h2>
        {linkedTeams.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No teams have a Google Group linked yet.</p>
        ) : (
          <div className="tablewrap">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Group email</th>
                    <th style={{ textAlign: "right" }}>Expected members</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedTeams.map((t, i) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="mono">{t.googleGroupEmail}</td>
                      <td style={{ textAlign: "right" }}>{counts[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">Last reconcile report</h2>
        {!lastReport ? (
          <p className="text-sm text-[var(--muted)]">No reconcile has run yet.</p>
        ) : (
          <>
            <p className="text-sm text-[var(--muted)]">
              Ran at <span className="mono">{new Date(lastReport.ranAt).toLocaleString()}</span>
            </p>
            <div className="flex flex-col gap-4">
              {lastReport.groups.map((g) => (
                <div key={g.groupEmail} className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{g.teamName}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {g.actualCount} actual / {g.expectedCount} expected
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Added: </span>
                    {g.added.length === 0 ? (
                      <span className="text-[var(--muted)]">none</span>
                    ) : (
                      g.added.map(resolve).join(", ")
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Would remove: </span>
                    {g.wouldRemove.length === 0 ? (
                      <span className="text-[var(--muted)]">none</span>
                    ) : (
                      g.wouldRemove.map(resolve).join(", ")
                    )}
                  </div>
                  {g.errors.length > 0 && (
                    <div className="text-sm text-[var(--red)]">
                      <span className="font-medium">Errors: </span>
                      {g.errors.join("; ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

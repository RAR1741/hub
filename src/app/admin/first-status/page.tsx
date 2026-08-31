import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getSetting, getTeamTimezone } from "@/lib/settings";
import { listPeople, displayName } from "@/lib/people";
import type { FirstSyncReport } from "@/lib/first-sync";
import { FirstSessionCard } from "@/components/FirstSessionCard";
import { FirstSyncPanel } from "@/components/FirstSyncPanel";
import { FirstStatusTable, type FirstStatusRow } from "@/components/FirstStatusTable";
import { FirstLinkPicker } from "@/components/FirstLinkPicker";

export const metadata: Metadata = { title: "FIRST Status" };

export default async function AdminFirstStatusPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

  const db = getDb();
  const [people, report, session, teamTz] = await Promise.all([
    listPeople(undefined, db),
    getSetting<FirstSyncReport | null>("first_last_sync_report", null, db),
    getSetting<{ cookie: string; savedAt: string } | null>("first_session", null, db),
    getTeamTimezone(db),
  ]);

  const staff = people.filter((p) => (p.role === "mentor" || p.role === "admin") && p.is_active);

  const rows: FirstStatusRow[] = staff.map((p) => ({
    personId: p.id,
    name: displayName(p),
    consent: p.first_people_id == null ? null : (p.first_consent_release ?? null),
    screeningStatus: p.first_screening_status ?? null,
    screeningText: p.first_screening_text ?? null,
    trainingStatus: p.first_training_status ?? null,
    syncedAt: p.first_synced_at ?? null,
  }));

  const peoplePicker = people
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>FIRST roster status</h1>
          <div className="sub">
            Last synced {report ? new Date(report.ranAt).toLocaleString(undefined, { timeZone: teamTz }) : "never"}
          </div>
        </div>
      </div>

      {report?.error === "session_expired" && (
        <p className="text-sm text-[var(--red)]">
          FIRST session expired — re-paste a fresh cookie below to resume syncing.
        </p>
      )}

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">FIRST session</h2>
        <FirstSessionCard savedAt={session?.savedAt ?? null} expired={report?.error === "session_expired"} teamTz={teamTz} />
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">Sync</h2>
        <FirstSyncPanel />
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">Mentor &amp; admin status</h2>
        <FirstStatusTable rows={rows} />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-base font-semibold">Unmatched FIRST roster entries</h2>
        {!report || report.unmatchedFirst.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {report?.error === "session_expired"
              ? "Unavailable until the FIRST session is refreshed and a sync completes."
              : "Everything on the FIRST roster is linked."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {report.unmatchedFirst.map((entry) => (
              <div
                key={entry.peopleId}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <div className="font-medium">{entry.name}</div>
                  <div className="text-sm text-[var(--muted)]">{entry.email}</div>
                </div>
                <FirstLinkPicker firstPeopleId={entry.peopleId} people={peoplePicker} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

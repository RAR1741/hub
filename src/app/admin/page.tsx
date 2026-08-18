import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { Icon } from "@/components/Icon";
import { listPeople } from "@/lib/people";
import { listTeams } from "@/lib/teams";
import { listPeriods, getActivePeriod } from "@/lib/periods";
import { listAllMeetings } from "@/lib/meetings";
import { listBuildDays } from "@/lib/build-days";
import { listSessionsForPeriod, flaggedSessions } from "@/lib/reports";
import { listKioskDevices } from "@/lib/kiosk";
import { listPendingAccountRequests, listPendingApplications } from "@/lib/requests";
import { listPendingExcusalRequests } from "@/lib/excusal-requests";
import { listEvents } from "@/lib/events";

type IconName = Parameters<typeof Icon>[0]["name"];

function Card({
  href,
  icon,
  title,
  count,
  hint,
  alert,
}: {
  href: string;
  icon: IconName;
  title: string;
  count?: number;
  hint?: string;
  // When true, draw a red border — used in Review to flag a non-empty queue.
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card flex flex-col gap-3 hover:no-underline ${
        alert ? "border-[var(--red)]" : "hover:border-[var(--steel)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[var(--ink)]">
          <Icon name={icon} />
          {title}
        </span>
        {count !== undefined && (
          <span className={`count mono ${alert ? "text-[var(--red)]" : ""}`}>{count}</span>
        )}
      </div>
      {hint && <p className="text-[13px] text-[var(--muted)]">{hint}</p>}
    </Link>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export default async function AdminHubPage() {
  const viewer = await getViewer();
  // Mentors+ reach the hub, but each section/card below is gated to the role
  // that its target page actually requires — mentors see only their subset.
  if (!hasRole(viewer.role, "mentor")) redirect("/");
  const isAdmin = hasRole(viewer.role, "admin");

  const activePeriod = await getActivePeriod();
  const [
    people,
    teams,
    periods,
    meetings,
    buildDays,
    sessions,
    flagged,
    kioskDevices,
    accountRequests,
    applications,
    excusalRequests,
    events,
  ] = await Promise.all([
    // Admin-only rows skip their query for mentors (they can't see those
    // cards); the rest (excusal requests, events) run for every viewer.
    isAdmin ? listPeople() : Promise.resolve([]),
    isAdmin ? listTeams() : Promise.resolve([]),
    isAdmin ? listPeriods() : Promise.resolve([]),
    isAdmin ? listAllMeetings() : Promise.resolve([]),
    activePeriod ? listBuildDays({ from: activePeriod.startsOn, to: activePeriod.endsOn }) : Promise.resolve([]),
    activePeriod ? listSessionsForPeriod(activePeriod.id) : Promise.resolve([]),
    activePeriod ? flaggedSessions(activePeriod.id) : Promise.resolve([]),
    isAdmin ? listKioskDevices() : Promise.resolve([]),
    isAdmin ? listPendingAccountRequests() : Promise.resolve([]),
    isAdmin ? listPendingApplications() : Promise.resolve([]),
    listPendingExcusalRequests(),
    listEvents(),
  ]);

  // Requests queue, scoped to what the viewer can actually act on:
  // admins review account + team-join + excusal; mentors only excusals.
  const requestsCount = isAdmin
    ? accountRequests.length + applications.length + excusalRequests.length
    : excusalRequests.length;

  return (
    <main className="flex flex-col gap-8">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <div className="sub">
            {activePeriod ? `Active period: ${activePeriod.name}` : "No active period"}
          </div>
        </div>
      </div>

      <Section label="Review">
        <Card
          href="/admin/requests"
          icon="check"
          title="Requests"
          count={requestsCount}
          alert={requestsCount > 0}
          hint={isAdmin ? "Pending account, team-join, and excusal approvals." : "Pending excusal approvals."}
        />
        <Card
          href="/admin/sessions/flagged"
          icon="clock"
          title="Flagged sessions"
          count={flagged.length}
          alert={flagged.length > 0}
          hint="Over-limit, open, or overlapping sessions."
        />
        <Card
          href="/admin/reports"
          icon="calendar"
          title="Reports"
          hint="Hours and attendance summaries, exportable as CSV."
        />
      </Section>

      {isAdmin && (
        <Section label="Roster">
          <Card href="/admin/people" icon="users" title="People" count={people.length} hint="Roster, roles, and student IDs." />
          <Card href="/admin/teams" icon="users" title="Teams" count={teams.length} hint="Sub-teams, join modes, membership." />
          <Card href="/admin/time-import" icon="clock" title="Time import" hint="Import a season's attendance from a Google-Sheets CSV." />
          <Card href="/admin/application-import" icon="users" title="Application import" hint="Import a season's student applications from a Google-Forms CSV." />
        </Section>
      )}

      <Section label="Time">
        {isAdmin && (
          <Card href="/admin/meetings" icon="calendar" title="Meetings" count={meetings.length} hint="Google Calendar sync + manual meetings." />
        )}
        <Card href="/admin/build-days" icon="calendar" title="Build days" count={buildDays.length} hint="Required/optional days for the active period." />
        <Card href="/admin/sessions" icon="clock" title="Sessions" count={sessions.length} hint="All attendance sessions, browse and edit." />
        <Card href="/admin/events" icon="calendar" title="Events" count={events.length} hint="Outreach, demos, training — sign-up + check-in." />
        {isAdmin && (
          <Card href="/admin/periods" icon="calendar" title="Periods" count={periods.length} hint="Seasons and the active period." />
        )}
      </Section>

      {isAdmin && (
        <Section label="Config">
          <Card href="/admin/kiosk-devices" icon="chevron" title="Kiosk devices" count={kioskDevices.length} hint="Shop-tablet sign-in tokens." />
          <Card href="/admin/drive-sync" icon="users" title="Drive group sync" hint="Linked teams, reconcile report, and Sync now." />
          <Card href="/admin/settings" icon="x" title="Settings" hint="Timezone, calendar sync, shift limits." />
        </Section>
      )}
    </main>
  );
}

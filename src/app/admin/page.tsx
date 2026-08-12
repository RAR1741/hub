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

type IconName = Parameters<typeof Icon>[0]["name"];

function Card({
  href,
  icon,
  title,
  count,
  hint,
}: {
  href: string;
  icon: IconName;
  title: string;
  count?: number;
  hint?: string;
}) {
  return (
    <Link href={href} className="card flex flex-col gap-3 hover:no-underline hover:border-[var(--steel)]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[var(--ink)]">
          <Icon name={icon} />
          {title}
        </span>
        {count !== undefined && <span className="count mono">{count}</span>}
      </div>
      {hint && <p className="text-[13px] text-[var(--muted)]">{hint}</p>}
    </Link>
  );
}

export default async function AdminHubPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");

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
  ] = await Promise.all([
    listPeople(),
    listTeams(),
    listPeriods(),
    listAllMeetings(),
    activePeriod ? listBuildDays({ from: activePeriod.startsOn, to: activePeriod.endsOn }) : Promise.resolve([]),
    activePeriod ? listSessionsForPeriod(activePeriod.id) : Promise.resolve([]),
    activePeriod ? flaggedSessions(activePeriod.id) : Promise.resolve([]),
    listKioskDevices(),
    listPendingAccountRequests(),
    listPendingApplications(),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <div className="sub">
            {activePeriod ? `Active period: ${activePeriod.name}` : "No active period"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card href="/admin/people" icon="users" title="People" count={people.length} hint="Roster, roles, and student IDs." />
        <Card href="/admin/teams" icon="users" title="Teams" count={teams.length} hint="Sub-teams, join modes, membership." />
        <Card href="/admin/periods" icon="calendar" title="Periods" count={periods.length} hint="Seasons and the active period." />
        <Card href="/admin/meetings" icon="calendar" title="Meetings" count={meetings.length} hint="Google Calendar sync + manual meetings." />
        <Card href="/admin/build-days" icon="calendar" title="Build days" count={buildDays.length} hint="Required/optional days for the active period." />
        <Card href="/admin/sessions" icon="clock" title="Sessions" count={sessions.length} hint="All attendance sessions, browse and edit." />
        <Card href="/admin/sessions/flagged" icon="clock" title="Flagged sessions" count={flagged.length} hint="Over-limit, open, or overlapping sessions." />
        <Card href="/admin/kiosk-devices" icon="chevron" title="Kiosk devices" count={kioskDevices.length} hint="Shop-tablet sign-in tokens." />
        <Card href="/admin/requests" icon="check" title="Requests" count={accountRequests.length + applications.length} hint="Pending account + team-join approvals." />
        <Card href="/admin/settings" icon="x" title="Settings" hint="Timezone, calendar sync, shift limits." />
      </div>
    </main>
  );
}

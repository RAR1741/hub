import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { WhosHere } from "@/components/WhosHere";
import { listWhosHere } from "@/lib/sessions";
import { getActivePeriod } from "@/lib/periods";
import { personPeriodHours } from "@/lib/reports";
import { listUpcomingMeetings } from "@/lib/meetings";
import { listBuildDays } from "@/lib/build-days";
import { getSetting } from "@/lib/settings";
import { hoursGoalProgress } from "@/lib/hours-goal";

export default async function HomePage() {
  const viewer = await getViewer();
  const here = viewer.person ? await listWhosHere() : [];
  const activePeriod = viewer.person ? await getActivePeriod() : null;
  const myHours =
    viewer.person && activePeriod
      ? await personPeriodHours(viewer.person.id, activePeriod.id)
      : 0;
  const hoursGoal =
    viewer.person && activePeriod
      ? await getSetting<number>("season_hours_goal", 0)
      : 0;
  const goalProgress = hoursGoalProgress(myHours, hoursGoal);
  const upcoming = await listUpcomingMeetings(new Date().toISOString(), 5);
  const requiredDates = new Set(
    upcoming.length
      ? (
          await listBuildDays({
            from: upcoming[0].startsAt.slice(0, 10),
            to: upcoming[upcoming.length - 1].startsAt.slice(0, 10),
          })
        )
          .filter((d) => d.kind === "required")
          .map((d) => d.date)
      : [],
  );
  // Render times in the team's timezone — on the server `undefined` resolves to
  // the host zone (UTC in prod), which showed the clock hours ahead of local.
  const teamTz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const now = new Date();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Team Hub</h1>

      {viewer.person && (
        <div className="status-strip">
          <span className="live">
            <span className="dot" aria-hidden="true" /> {here.length} on the clock
          </span>
          <span className="sep" aria-hidden="true" />
          {activePeriod && <span>{activePeriod.name}</span>}
          <span className="grow" />
          <span className="date mono">
            {now.toLocaleDateString(undefined, { weekday: "short", timeZone: teamTz })} ·{" "}
            {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: teamTz })}
          </span>
        </div>
      )}

      {viewer.person ? (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[var(--color-muted-fg)]">
                Signed in as{" "}
                <span className="font-medium text-[var(--color-fg)]">
                  {viewer.person.firstName} {viewer.person.lastName}
                </span>{" "}
                ({viewer.role})
              </p>
              <nav aria-label="Quick links" className="mt-3 flex flex-wrap gap-4">
                {hasRole(viewer.role, "mentor") && (
                  <Link href="/people" className="text-sm font-medium text-[var(--color-brand)]">
                    People
                  </Link>
                )}
                <Link href="/teams" className="text-sm font-medium text-[var(--color-brand)]">
                  Teams
                </Link>
              </nav>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <WhosHere initial={here.map((h) => ({ name: h.name, since: h.since }))} />

            {activePeriod && (
              <div className="card stat">
                <p className="eyebrow">{activePeriod.name} · your hours</p>
                <div className="num" style={{ marginTop: 6 }}>
                  {myHours}
                  <small> h</small>
                </div>
                {goalProgress && (
                  <>
                    <div className="bar">
                      <i style={{ width: `${goalProgress.pct}%` }} />
                    </div>
                    <p className="text-sm" style={{ color: "var(--muted)", marginTop: 8 }}>
                      {myHours} of {goalProgress.goal} h · {goalProgress.remaining} to go
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="card text-[var(--color-muted-fg)]">
          Browsing as guest.{" "}
          <Link href="/login" className="font-medium text-[var(--color-brand)]">
            Sign in
          </Link>
        </p>
      )}

      <section className="card meets">
        <div className="card-head">
          <h3>Upcoming meetings</h3>
          <span className="count">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-muted-fg)]">
            No upcoming meetings scheduled.
          </p>
        ) : (
          upcoming.map((m) => {
            const start = new Date(m.startsAt);
            const dateKey = m.startsAt.slice(0, 10);
            return (
              <div key={m.id} className="meet">
                <span className="d mono">
                  {start
                    .toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric", timeZone: teamTz })
                    .toUpperCase()}
                </span>
                <span className="t">{m.title}</span>
                {requiredDates.has(dateKey) && <span className="req">Required</span>}
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}

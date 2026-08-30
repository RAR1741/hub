import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { listExcusalRequestsForPerson } from "@/lib/excusal-requests";
import { personSessions } from "@/lib/reports";
import { totalHours } from "@/lib/hours";
import { hoursGoalProgress } from "@/lib/hours-goal";
import { getSetting } from "@/lib/settings";
import { attendanceForDate, attendanceSummary, localDateOf } from "@/lib/attendance";
import { ExcusalRequestForm } from "@/components/ExcusalRequestForm";
import { ExcusalRequestList } from "@/components/ExcusalRequestList";
import { MissedDaysExcusal } from "@/components/MissedDaysExcusal";

export const metadata: Metadata = { title: "My Attendance" };

export default async function MyAttendancePage() {
  const viewer = await getViewer();
  if (!viewer.person) {
    redirect("/login");
  }

  const personId = viewer.person.id;
  const period = await getActivePeriod();
  if (!period) {
    const myRequests = await listExcusalRequestsForPerson(personId);
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">My Attendance</h1>
        <p className="card text-[var(--muted)]">No active period yet.</p>
        <section className="card flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Request excusal</h2>
          <ExcusalRequestForm />
        </section>
        <section className="card flex flex-col gap-3">
          <h2 className="text-lg font-semibold">My excusal requests</h2>
          <ExcusalRequestList requests={myRequests} />
        </section>
      </main>
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const hoursGoal = await getSetting<number>("season_hours_goal", 0);
  const range = { from: period.startsOn, to: period.endsOn };
  const [buildDays, allExcusals, sessions, myRequests] = await Promise.all([
    listBuildDays(range),
    listExcusals(range),
    personSessions(personId, period.id),
    listExcusalRequestsForPerson(personId),
  ]);
  const excusals = allExcusals.filter((e) => e.personId === personId);
  const summary = attendanceSummary(personId, buildDays, sessions, excusals, tz);
  const myHours = Math.round(totalHours(sessions) * 100) / 100;
  const goalProgress = hoursGoalProgress(myHours, hoursGoal);

  // Required build days, in the past, where the viewer has no session and no
  // existing excusal — attendanceForDate already returns "excused" (not
  // "absent") when an excusal exists, so filtering on "absent" here can't
  // double-count an already-excused day.
  const today = localDateOf(new Date().toISOString(), tz);
  const missedRequiredDates = buildDays
    .filter((d) => d.kind === "required" && d.date < today)
    .filter((d) => attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz) === "absent")
    .map((d) => d.date);
  const pendingDates = myRequests.filter((r) => r.status === "pending").map((r) => r.date);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">
        My Attendance — {period.name}
      </h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card stat flex flex-wrap items-end gap-4">
          <div>
            <div className="eyebrow">Attendance</div>
            <div className="num mono">
              {summary.percentage === null ? "—" : summary.percentage}
              {summary.percentage !== null && <small>%</small>}
            </div>
          </div>
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            {summary.present} present, {summary.excused} excused, {summary.absent} absent,{" "}
            {summary.optional} optional
          </span>
        </div>
        <div className="card stat">
          <p className="eyebrow">{period.name} · your hours</p>
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
      </div>
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {missedRequiredDates.length} required build days missed
        </h2>
        {missedRequiredDates.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No missed required days — nice.
          </p>
        ) : (
          <MissedDaysExcusal missedDates={missedRequiredDates} pendingDates={pendingDates} />
        )}
      </section>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {buildDays.map((d) => {
              const status = attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz);
              return (
                <tr key={d.date}>
                  <td className="mono">{d.date}</td>
                  <td>{d.kind}</td>
                  <td>
                    <span className={`pill status-${status}`}>{status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Request excusal</h2>
        <ExcusalRequestForm />
      </section>
      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My excusal requests</h2>
        <ExcusalRequestList requests={myRequests} />
      </section>
    </main>
  );
}

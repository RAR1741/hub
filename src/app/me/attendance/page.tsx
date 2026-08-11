import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { personSessions } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { attendanceForDate, attendanceSummary } from "@/lib/attendance";

export default async function MyAttendancePage() {
  const viewer = await getViewer();
  if (!viewer.person) {
    redirect("/login");
  }

  const period = await getActivePeriod();
  if (!period) {
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">My Attendance</h1>
        <p className="card text-[var(--color-muted-fg)]">No active period yet.</p>
      </main>
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const range = { from: period.startsOn, to: period.endsOn };
  const personId = viewer.person.id;
  const [buildDays, allExcusals, sessions] = await Promise.all([
    listBuildDays(range),
    listExcusals(range),
    personSessions(personId, period.id),
  ]);
  const excusals = allExcusals.filter((e) => e.personId === personId);
  const summary = attendanceSummary(personId, buildDays, sessions, excusals, tz);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">
        My Attendance — {period.name}
      </h1>
      <div className="card flex flex-wrap items-baseline gap-3">
        <span className="text-sm text-[var(--color-muted-fg)]">Attendance</span>
        <span className="text-3xl font-bold text-[var(--color-brand)]">
          {summary.percentage === null ? "—" : `${summary.percentage}%`}
        </span>
        <span className="text-sm text-[var(--color-muted-fg)]">
          ({summary.present} present, {summary.excused} excused, {summary.absent} absent,{" "}
          {summary.optional} optional)
        </span>
      </div>
      <div className="card overflow-x-auto">
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
                  <td>{d.date}</td>
                  <td>{d.kind}</td>
                  <td>
                    <span className={`badge badge-${status}`}>{status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

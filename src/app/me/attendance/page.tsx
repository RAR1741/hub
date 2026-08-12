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
        <p className="card text-[var(--muted)]">No active period yet.</p>
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
    </main>
  );
}

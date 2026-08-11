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
      <main>
        <h1>My Attendance</h1>
        <p>No active period yet.</p>
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
    <main>
      <h1>My Attendance — {period.name}</h1>
      <p>
        Attendance: <strong>{summary.percentage === null ? "—" : `${summary.percentage}%`}</strong>
        {" "}({summary.present} present, {summary.excused} excused, {summary.absent} absent,
        {" "}{summary.optional} optional)
      </p>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          {buildDays.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.kind}</td>
              <td>{attendanceForDate(personId, d.date, d.kind, sessions, excusals, tz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

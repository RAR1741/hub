import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { sessionsForPeriod } from "@/lib/reports";
import { listPeople, displayName } from "@/lib/people";
import { getSetting } from "@/lib/settings";
import { attendanceForDate, attendanceSummary } from "@/lib/attendance";
import { AttendanceCell } from "@/components/AttendanceGridActions";

export default async function CalendarPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const period = await getActivePeriod();
  if (!period) {
    return (
      <main>
        <h1>Calendar</h1>
        <p>No active period. Create one in Admin → Periods.</p>
      </main>
    );
  }

  const tz = await getSetting<string>("team_timezone", "America/Indiana/Indianapolis");
  const range = { from: period.startsOn, to: period.endsOn };
  const [buildDays, excusals, sessions, peopleRows] = await Promise.all([
    listBuildDays(range),
    listExcusals(range),
    sessionsForPeriod(period.id),
    listPeople(),
  ]);
  const members = peopleRows
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main>
      <style>{`
        .grid { border-collapse: collapse; }
        .grid td, .grid th { border: 1px solid #ccc; padding: 2px 4px; font-size: 12px; }
        .grid td[data-status] .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
        .grid td[data-status="present"] .dot { background: #2e7d32; }
        .grid td[data-status="excused"] .dot { background: #f9a825; }
        .grid td[data-status="optional"] .dot { background: #90caf9; }
        .grid td[data-status="absent"] .dot { background: #c62828; }
        .grid .cell-actions { display: none; }
        .grid td:hover .cell-actions { display: inline; }
      `}</style>
      <h1>Calendar — {period.name}</h1>
      {buildDays.length === 0 ? (
        <p>No build days yet. Add them in Admin (build-days API) or connect Google Calendar.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Member</th>
                <th>%</th>
                {buildDays.map((d) => (
                  <th key={d.date}>{d.date.slice(5)}{d.kind === "optional" ? "*" : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const summary = attendanceSummary(m.id, buildDays, sessions, excusals, tz);
                return (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{summary.percentage === null ? "—" : `${summary.percentage}%`}</td>
                    {buildDays.map((d) => (
                      <AttendanceCell
                        key={d.date}
                        personId={m.id}
                        date={d.date}
                        status={attendanceForDate(m.id, d.date, d.kind, sessions, excusals, tz)}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p><small>* optional day. Green present · amber excused · blue optional · red absent. Hover a cell for actions.</small></p>
        </div>
      )}
    </main>
  );
}

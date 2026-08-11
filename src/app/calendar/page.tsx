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
      <main className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <p className="card text-[var(--color-muted-fg)]">
          No active period. Create one in Admin → Periods.
        </p>
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
    <main className="flex flex-col gap-6">
      <style>{`
        .attendance-grid { border-collapse: collapse; }
        .attendance-grid td, .attendance-grid th {
          border: 1px solid var(--color-border);
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
        }
        .attendance-grid thead th {
          position: sticky;
          top: 0;
          background: var(--color-canvas);
          color: var(--color-muted-fg);
          font-weight: 600;
          z-index: 1;
        }
        .attendance-grid tbody th,
        .attendance-grid tbody td:first-child {
          position: sticky;
          left: 0;
          background: var(--color-surface);
          text-align: left;
          font-weight: 500;
          z-index: 1;
        }
        .attendance-grid thead th:first-child {
          left: 0;
          z-index: 2;
        }
        .attendance-grid td[data-status] { text-align: center; }
        .attendance-grid td[data-status] .dot {
          display: inline-block;
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 9999px;
        }
        .attendance-grid td[data-status="present"] .dot { background: var(--color-present); }
        .attendance-grid td[data-status="excused"] .dot { background: var(--color-excused); }
        .attendance-grid td[data-status="optional"] .dot { background: var(--color-optional); }
        .attendance-grid td[data-status="absent"] .dot { background: var(--color-absent); }
        .attendance-grid .cell-actions { display: none; margin-left: 0.25rem; }
        .attendance-grid td:hover .cell-actions { display: inline-flex; gap: 0.25rem; }
        .attendance-grid .cell-actions button {
          font-size: 0.6875rem;
          padding: 0.0625rem 0.3125rem;
          border-radius: 0.25rem;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-fg);
          cursor: pointer;
        }
      `}</style>
      <h1 className="text-3xl font-bold tracking-tight">Calendar — {period.name}</h1>
      {buildDays.length === 0 ? (
        <p className="card text-[var(--color-muted-fg)]">
          No build days yet. Add them in Admin (build-days API) or connect Google Calendar.
        </p>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
            <table className="attendance-grid">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>%</th>
                  {buildDays.map((d) => (
                    <th key={d.date}>
                      {d.date.slice(5)}
                      {d.kind === "optional" ? "*" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const summary = attendanceSummary(m.id, buildDays, sessions, excusals, tz);
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="font-medium">
                        {summary.percentage === null ? "—" : `${summary.percentage}%`}
                      </td>
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
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted-fg)]">
            * optional day. Green present · blue excused · slate optional · red absent. Hover a
            cell for actions.
          </p>
        </div>
      )}
    </main>
  );
}

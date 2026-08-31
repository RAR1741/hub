import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { listBuildDays } from "@/lib/build-days";
import { listExcusals } from "@/lib/excusals";
import { sessionsForPeriod } from "@/lib/reports";
import { listPeople, displayName } from "@/lib/people";
import { getTeamTimezone } from "@/lib/settings";
import { attendanceForDate, attendanceSummary } from "@/lib/attendance";
import { AttendanceCell } from "@/components/AttendanceGridActions";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const period = await getActivePeriod();
  if (!period) {
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <p className="card text-[var(--muted)]">
          No active period. Create one in Admin → Periods.
        </p>
      </main>
    );
  }

  const tz = await getTeamTimezone();
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
        .attendance-grid { border-collapse: collapse; font-size: 0.75rem; }
        .attendance-grid td, .attendance-grid th {
          border: 1px solid var(--hair);
          padding: 0.35rem 0.6rem;
        }
        .attendance-grid thead th {
          position: sticky;
          top: 0;
          background: var(--surface);
          color: var(--muted);
          font-size: 10.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 700;
          z-index: 1;
        }
        .attendance-grid tbody th,
        .attendance-grid tbody td:first-child {
          position: sticky;
          left: 0;
          background: var(--surface);
          text-align: left;
          font-weight: 600;
          z-index: 1;
        }
        .attendance-grid thead th:first-child {
          left: 0;
          z-index: 2;
        }
        .attendance-grid tbody td:nth-child(2) {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .attendance-grid tbody tr:hover td {
          background: var(--surface-2);
        }
        .attendance-grid tbody tr:hover td:first-child {
          background: var(--surface-2);
        }
        .attendance-grid td[data-status] { text-align: center; }
        .attendance-grid td[data-status] .dot {
          display: inline-block;
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 9999px;
        }
        .attendance-grid td[data-status="present"] .dot { background: var(--present); }
        .attendance-grid td[data-status="excused"] .dot { background: var(--excused); }
        .attendance-grid td[data-status="optional"] .dot { background: var(--optional); }
        .attendance-grid td[data-status="absent"] .dot { background: var(--absent); }
        /* Reveal on hover, but keep the buttons focusable (opacity, not
           display:none) so keyboard users reach them; always show where hover
           isn't available (touch/tablet — the mentor's likely device). */
        .attendance-grid .cell-actions {
          display: inline-flex;
          gap: 0.25rem;
          margin-left: 0.25rem;
          opacity: 0;
          transition: opacity 0.12s ease;
        }
        .attendance-grid td:hover .cell-actions,
        .attendance-grid td:focus-within .cell-actions { opacity: 1; }
        @media (hover: none) { .attendance-grid .cell-actions { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .attendance-grid .cell-actions { transition: none; }
        }
        .attendance-grid .cell-actions button {
          font-size: 0.6875rem;
          font-weight: 650;
          padding: 0.0625rem 0.375rem;
          border-radius: 0.3rem;
          border: 1px solid var(--hair);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
        }
        .attendance-grid .cell-actions button:hover {
          border-color: var(--steel);
        }
      `}</style>
      <div className="page-head">
        <div>
          <h1>Calendar — {period.name}</h1>
        </div>
      </div>
      {buildDays.length === 0 ? (
        <p className="card text-[var(--muted)]">
          No build days yet. Add them in Admin (build-days API) or connect Google Calendar.
        </p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
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
          </div>
          <p className="text-xs" style={{ color: "var(--muted)", padding: "12px 16px" }}>
            * optional day. Green present · blue excused · slate optional · amber absent. Hover a
            cell for actions.
          </p>
        </div>
      )}
    </main>
  );
}

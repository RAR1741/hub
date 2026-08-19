import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { hoursReportForPeriod, dietaryRestrictionsReport } from "@/lib/reports";
import { attendanceSummaryForPeriod } from "@/lib/attendance";

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ period }, viewer, periods, dietaryRows] = await Promise.all([
    searchParams, getViewer(), listPeriods(), dietaryRestrictionsReport(),
  ]);
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const active = await getActivePeriod();
  const periodId = period ?? active?.id ?? periods[0]?.id;

  const [hoursRows, attendanceRows] = periodId
    ? await Promise.all([hoursReportForPeriod(periodId), attendanceSummaryForPeriod(periodId)])
    : [[], []];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub">Hours, attendance, and dietary restrictions, exportable as CSV.</div>
        </div>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="reports-period">
            Period
          </label>
          <select
            id="reports-period"
            className="input"
            name="period"
            defaultValue={periodId ?? ""}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          View
        </button>
      </form>

      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Dietary restrictions ({dietaryRows.length})</h2>
          <a className="btn" href="/api/admin/reports/dietary">
            Export CSV
          </a>
        </div>
        {dietaryRows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No active members have dietary restrictions on file.
          </p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Dietary restriction</th>
                </tr>
              </thead>
              <tbody>
                {dietaryRows.map((r) => (
                  <tr key={r.personId}>
                    <td>{r.name}</td>
                    <td>{r.role}</td>
                    <td>{r.dietaryRestrictions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!periodId ? (
        <p className="card text-[var(--muted)]">No periods yet — create one in Admin → Periods.</p>
      ) : (
        <>
          <section className="card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Hours</h2>
              <a
                className="btn"
                href={`/api/admin/reports/hours?period=${periodId}`}
              >
                Export CSV
              </a>
            </div>
            {hoursRows.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No active members for this period.
              </p>
            ) : (
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Student ID</th>
                      <th>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoursRows.map((r) => (
                      <tr key={r.personId}>
                        <td>{r.name}</td>
                        <td className="mono">{r.studentId ?? "—"}</td>
                        <td className="mono">{r.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Attendance summary</h2>
              <a
                className="btn"
                href={`/api/admin/reports/attendance?period=${periodId}`}
              >
                Export CSV
              </a>
            </div>
            {attendanceRows.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No active members for this period.
              </p>
            ) : (
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Present</th>
                      <th>Excused</th>
                      <th>Absent</th>
                      <th>Required</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map((r) => (
                      <tr key={r.personId}>
                        <td>{r.name}</td>
                        <td className="mono">{r.present}</td>
                        <td className="mono">{r.excused}</td>
                        <td className="mono">{r.absent}</td>
                        <td className="mono">{r.requiredDays}</td>
                        <td className="mono">
                          {r.percentage === null ? "—" : `${r.percentage}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

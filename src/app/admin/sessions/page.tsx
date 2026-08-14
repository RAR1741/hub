import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { listSessionsForPeriod } from "@/lib/reports";
import { listPeople, displayName } from "@/lib/people";
import { SessionEditRow } from "@/components/SessionEditRow";

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; person?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [{ period, person }, periods, peopleRows] = await Promise.all([
    searchParams,
    listPeriods(),
    listPeople(),
  ]);

  const active = await getActivePeriod();
  const periodId = period ?? active?.id ?? periods[0]?.id;
  const sessions = periodId ? await listSessionsForPeriod(periodId, person || undefined) : [];
  const members = peopleRows
    .map((p) => ({ id: p.id, name: displayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <div className="sub">All attendance sessions · {sessions.length} shown</div>
        </div>
      </div>
      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="sessions-period">Period</label>
          <select id="sessions-period" className="input" name="period" defaultValue={periodId ?? ""}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sessions-person">Member</label>
          <select id="sessions-person" className="input" name="person" defaultValue={person ?? ""}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">View</button>
      </form>
      {sessions.length === 0 ? (
        <p className="card text-[var(--muted)]">
          No sessions for this filter — try a different period or member.
        </p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Member</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th><th>Excl.</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <SessionEditRow
                    key={s.id}
                    id={s.id}
                    timeIn={s.timeIn}
                    timeOut={s.timeOut}
                    note={s.note}
                    excluded={s.excludedFromTotals}
                    label={s.name}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

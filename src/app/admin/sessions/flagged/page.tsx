import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { flaggedSessions } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { SessionEditRow } from "@/components/SessionEditRow";

export default async function FlaggedSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const [{ period }, periods, active, maxShift] = await Promise.all([
    searchParams,
    listPeriods(),
    getActivePeriod(),
    getSetting<number>("max_shift_hours", 18),
  ]);

  // Default to the active period, falling back to the newest, so the page still
  // works when no period is active (e.g. between seasons).
  const periodId = period ?? active?.id ?? periods[0]?.id;
  const selected = periods.find((p) => p.id === periodId) ?? null;
  const flagged = periodId ? await flaggedSessions(periodId) : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Flagged sessions{selected ? ` — ${selected.name}` : ""}</h1>
          <div className="sub">
            Over {maxShift}h, still open, auto-closed by the nightly sweep, or overlapping another session.
          </div>
        </div>
      </div>
      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="flagged-period">Period</label>
          <select id="flagged-period" className="input" name="period" defaultValue={periodId ?? ""}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">View</button>
      </form>
      {flagged.length === 0 ? (
        <p className="card text-[var(--muted)]">Nothing flagged — every session looks clean.</p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Member</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th><th>Excl.</th><th>Flags / actions</th></tr>
              </thead>
              <tbody>
                {flagged.map((f) => (
                  <SessionEditRow
                    key={f.session.id}
                    id={f.session.id}
                    timeIn={f.session.timeIn}
                    timeOut={f.session.timeOut}
                    note={f.session.note}
                    excluded={f.session.excludedFromTotals}
                    label={`${f.name} [${[...f.flags, ...(f.overlapping ? ["overlap"] : [])].join(", ")}]`}
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

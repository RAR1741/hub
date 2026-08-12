import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { flaggedSessions } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { SessionEditRow } from "@/components/SessionEditRow";

export default async function FlaggedSessionsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/");

  const period = await getActivePeriod();
  const maxShift = await getSetting<number>("max_shift_hours", 18);
  const flagged = period ? await flaggedSessions(period.id) : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Flagged sessions{period ? ` — ${period.name}` : ""}</h1>
          <div className="sub">
            Over {maxShift}h, still open, auto-closed by the nightly sweep, or overlapping another session.
          </div>
        </div>
      </div>
      {flagged.length === 0 ? (
        <p className="card text-[var(--muted)]">Nothing flagged.</p>
      ) : (
        <div className="tablewrap">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Member</th><th>In</th><th>Out</th><th>Note</th><th>Excl.</th><th>Flags / actions</th></tr>
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

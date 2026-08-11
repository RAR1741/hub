import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod } from "@/lib/periods";
import { flaggedSessions } from "@/lib/reports";
import { SessionEditRow } from "@/components/SessionEditRow";

export default async function FlaggedSessionsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "mentor")) redirect("/login");

  const period = await getActivePeriod();
  const flagged = period ? await flaggedSessions(period.id) : [];

  return (
    <main>
      <h1>Flagged sessions{period ? ` — ${period.name}` : ""}</h1>
      <p>Over {`${18}`}h, still open, auto-closed by the nightly sweep, or overlapping another session.</p>
      {flagged.length === 0 ? (
        <p>Nothing flagged. 🎉</p>
      ) : (
        <table>
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
      )}
    </main>
  );
}

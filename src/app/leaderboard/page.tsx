import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { periodLeaderboard, type LeaderboardEntry } from "@/lib/reports";
import { publicName } from "@/lib/people";

// Guests may only ever see a first name + last initial (except on the Kiosk).
function entryLabel(e: LeaderboardEntry, masked: boolean): string {
  return masked ? publicName({ first_name: e.firstName, last_name: e.lastName }) : e.name;
}

function LeaderColumn({
  title,
  rows,
  masked,
}: {
  title: string;
  rows: LeaderboardEntry[];
  masked: boolean;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No hours logged yet.</p>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Hours</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.personId}>
                  <td className="mono" style={{ color: "var(--muted)" }}>
                    {i + 1}
                  </td>
                  <td>
                    {masked ? (
                      // Guests get no profile link (profiles are gated) and a masked name.
                      <span className="font-medium">{entryLabel(e, true)}</span>
                    ) : (
                      <Link href={`/people/${e.personId}`} className="font-medium">
                        {entryLabel(e, false)}
                      </Link>
                    )}
                  </td>
                  <td className="mono">{e.hours}</td>
                  <td className="mono">{e.sessionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ period }, viewer, periods] = await Promise.all([
    searchParams, getViewer(), listPeriods(),
  ]);
  // Open to guests: hours + names only, no contact detail. Guests see masked
  // names (first + last initial). The CSV export hits a mentor-gated route, so
  // only show that button to mentors+.
  const canExport = hasRole(viewer.role, "mentor");
  const masked = viewer.role === "guest";
  const active = await getActivePeriod();
  const periodId = period ?? active?.id ?? periods[0]?.id;
  const entries = periodId ? await periodLeaderboard(periodId) : [];
  const students = entries.filter((e) => e.role === "student");
  const mentors = entries.filter((e) => e.role !== "student");

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <div className="sub">Hours logged this period, ranked</div>
        </div>
        {canExport && periodId && (
          <a className="btn" href={`/api/admin/reports/hours?period=${periodId}`}>
            Export CSV
          </a>
        )}
      </div>
      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="leaderboard-period">
            Period
          </label>
          <select
            id="leaderboard-period"
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
      {entries.length === 0 ? (
        <p className="card text-[var(--muted)]">
          No hours logged for this period yet — clock in to start climbing the board.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LeaderColumn title="Students" rows={students} masked={masked} />
          <LeaderColumn title="Mentors" rows={mentors} masked={masked} />
        </div>
      )}
    </main>
  );
}

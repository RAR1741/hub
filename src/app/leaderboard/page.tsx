import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { getActivePeriod, listPeriods } from "@/lib/periods";
import { periodLeaderboard } from "@/lib/reports";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ period }, viewer, periods] = await Promise.all([
    searchParams, getViewer(), listPeriods(),
  ]);
  void viewer; // open to guests: hours + names only, no contact detail
  const active = await getActivePeriod();
  const periodId = period ?? active?.id ?? periods[0]?.id;
  const entries = periodId ? await periodLeaderboard(periodId) : [];

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <div className="sub">Hours logged this period, ranked</div>
        </div>
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
            {entries.map((e, i) => (
              <tr key={e.personId}>
                <td className="mono" style={{ color: "var(--muted)" }}>
                  {i + 1}
                </td>
                <td>
                  <Link href={`/people/${e.personId}`} className="font-medium">
                    {e.name}
                  </Link>
                </td>
                <td className="mono">{e.hours}</td>
                <td className="mono">{e.sessionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

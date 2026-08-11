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
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
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
      <div className="card overflow-x-auto">
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
                <td className="font-medium text-[var(--color-muted-fg)]">{i + 1}</td>
                <td>
                  <Link
                    href={`/people/${e.personId}`}
                    className="font-medium text-[var(--color-brand)]"
                  >
                    {e.name}
                  </Link>
                </td>
                <td>{e.hours}</td>
                <td>{e.sessionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

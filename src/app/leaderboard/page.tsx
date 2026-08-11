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
    <main>
      <h1>Leaderboard</h1>
      <form method="get">
        <label>Period{" "}
          <select name="period" defaultValue={periodId ?? ""}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isActive ? " (active)" : ""}</option>
            ))}
          </select>
        </label>
        <button type="submit">View</button>
      </form>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Hours</th><th>Sessions</th></tr></thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.personId}>
              <td>{i + 1}</td>
              <td><Link href={`/people/${e.personId}`}>{e.name}</Link></td>
              <td>{e.hours}</td>
              <td>{e.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

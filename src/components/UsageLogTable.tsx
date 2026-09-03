import Link from "next/link";
import { displayName } from "@/lib/people";
import type { BatteryUsage } from "@/lib/types";
import { DeleteUsageButton } from "./DeleteUsageButton";

function testCell(v: boolean | null): string {
  if (v === null) return "";
  return v ? "Good" : "Bad";
}

/** Rows: used at, battery, event/match, pre/post %, Rint, tests, problem, tech, notes (§6). */
export function UsageLogTable({
  rows,
  batteryNumbers,
  canDelete,
  emptyLabel = "No usage logged yet.",
}: {
  rows: BatteryUsage[];
  /** id -> number, for the battery link column. Omit the column entirely on the per-battery table. */
  batteryNumbers?: Map<string, string>;
  canDelete: boolean;
  emptyLabel?: string;
}) {
  if (rows.length === 0) return <p className="card text-sm text-[var(--muted)]">{emptyLabel}</p>;

  return (
    <div className="tablewrap">
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Used at</th>
              {batteryNumbers && <th>Battery</th>}
              <th>Event/Match</th>
              <th>Pre %</th>
              <th>Post %</th>
              <th>Rint (Ω)</th>
              <th>Wiggle</th>
              <th>Charger</th>
              <th>Problem</th>
              <th>Tech</th>
              <th>Notes</th>
              {canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{new Date(r.usedAt).toLocaleString()}</td>
                {batteryNumbers && (
                  <td><Link href={`/batteries/${r.batteryId}`}>{batteryNumbers.get(r.batteryId) ?? r.batteryId}</Link></td>
                )}
                <td>{[r.eventKey, r.matchKey].filter(Boolean).join(" / ")}</td>
                <td>{r.chargePrePct ?? ""}</td>
                <td>{r.chargePostPct ?? ""}</td>
                <td>{r.rintOhms ?? ""}</td>
                <td>{testCell(r.wiggleTestOk)}</td>
                <td>{testCell(r.chargerTestOk)}</td>
                <td>{r.hadProblem ? (r.problemDescription || "Yes") : ""}</td>
                <td>{displayName({ first_name: r.tech.firstName, last_name: r.tech.lastName, display_name: r.tech.displayName })}</td>
                <td>{r.notes ?? ""}</td>
                {canDelete && <td><DeleteUsageButton usageId={r.id} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

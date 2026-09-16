import Link from "next/link";
import { displayName } from "@/lib/people";
import type { ToolCheck } from "@/lib/types";
import { DeleteCheckButton } from "./DeleteCheckButton";

/** Rows: checked at, tool (link; omitted on detail page via optional `toolNames`), kind, condition, status after, by, notes (§6). */
export function ToolCheckTable({
  rows,
  toolNames,
  canDelete,
  emptyLabel = "No checks logged yet.",
}: {
  rows: ToolCheck[];
  /** id -> name, for the tool link column. Omit the column entirely on the per-tool table. */
  toolNames?: Map<string, string>;
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
              <th>Checked at</th>
              {toolNames && <th>Tool</th>}
              <th>Kind</th>
              <th>Condition</th>
              <th>Status after</th>
              <th>By</th>
              <th>Notes</th>
              {canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{new Date(r.checkedAt).toLocaleString()}</td>
                {toolNames && (
                  <td><Link href={`/tools/${r.toolId}`}>{toolNames.get(r.toolId) ?? r.toolId}</Link></td>
                )}
                <td>{r.kind}</td>
                <td>{r.condition}</td>
                <td>{r.statusAfter ? r.statusAfter.replace(/_/g, " ") : ""}</td>
                <td>{displayName({ first_name: r.checkedBy.firstName, last_name: r.checkedBy.lastName, display_name: r.checkedBy.displayName })}</td>
                <td>{r.notes ?? ""}</td>
                {canDelete && <td><DeleteCheckButton checkId={r.id} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { Part } from "@/lib/types";
import { fullPartNumber, PRIORITY_MAP } from "@/lib/types";
import { PartStatusCell } from "./PartStatusCell";

/**
 * Shared by the project detail page and an assembly's children list (Part
 * detail page, Task 5). Presentational only — takes the already-fetched,
 * already-sorted rows; parent lookup is resolved from this same `parts` array
 * (matches `sortParts`'s "parent" key), so a subset of rows just shows no
 * parent link when the parent isn't in the subset.
 */
export function PartsTable({ parts, projectPrefix }: { parts: Part[]; projectPrefix: string }) {
  if (parts.length === 0) return <p className="card text-sm text-[var(--muted)]">No parts yet.</p>;

  const byId = new Map(parts.map((p) => [p.id, p]));

  return (
    <div className="tablewrap">
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Number</th><th>Type</th><th>Name</th><th>Parent</th><th>Status</th><th>Priority</th></tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const parent = p.parentPartId ? byId.get(p.parentPartId) : undefined;
              return (
                <tr key={p.id}>
                  <td className="mono">
                    <Link href={`/admin/parts/${p.id}`}>{fullPartNumber(projectPrefix, p.type, p.partNumber)}</Link>
                  </td>
                  <td>{p.type}</td>
                  <td>{p.name}</td>
                  <td>
                    {parent ? (
                      <Link href={`/admin/parts/${parent.id}`}>{fullPartNumber(projectPrefix, parent.type, parent.partNumber)}</Link>
                    ) : ""}
                  </td>
                  <td><PartStatusCell partId={p.id} status={p.status} /></td>
                  <td>{PRIORITY_MAP[p.priority]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type FirstStatusRow = {
  personId: string;
  name: string;
  consent: boolean | null;
  screeningStatus: string | null;
  screeningText: string | null;
  trainingStatus: string | null;
  syncedAt: string | null;
};

/**
 * Shared status pill. FIRST's own colors: green = complete, orange = in
 * progress (vendor-side), blue = action needed, grey/unknown = no data.
 * Consent booleans map to green/blue by the caller (see FirstStatusTable
 * below). Exported for reuse by the person-page card (Task 6).
 *
 * Reuses `pill.status-*` (not `pill.on/off/role`, which brief drafts as
 * "on/off/role" but which render as near-identical steel/grey in this
 * design system) since status-present/status-absent/status-excused are the
 * three colors (green/orange/blue) that already exist and read distinctly.
 */
export function StatusBadge({ status, label }: { status: string | null; label?: string }) {
  const cls =
    status === "green" ? "pill status-present" :
    status === "orange" ? "pill status-absent" :
    status === "blue" ? "pill status-excused" :
    "pill";
  const text =
    label ?? (status === "green" ? "Complete" : status === "orange" ? "In progress" : status === "blue" ? "Action needed" : "—");
  return <span className={cls}>{text}</span>;
}

type SortKey = "name" | "consent" | "screening" | "training";

function statusSortText(status: string | null): string {
  // Order roughly worst -> best so ascending sort surfaces action items first.
  return status === "blue" ? "0" : status === "orange" ? "1" : status === "green" ? "2" : "3";
}

function sortValue(row: FirstStatusRow, key: SortKey): string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "consent":
      return row.consent == null ? "0" : row.consent ? "2" : "1";
    case "screening":
      return statusSortText(row.screeningStatus);
    case "training":
      return statusSortText(row.trainingStatus);
  }
}

function Th({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onToggle: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button type="button" className="link-btn" onClick={() => onToggle(sortKey)}>
        {label}
        {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

export function FirstStatusTable({ rows }: { rows: FirstStatusRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = av.localeCompare(bv) || a.name.localeCompare(b.name);
      return cmp * sort.dir;
    });
  }, [rows, sort]);

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No active mentors or admins on the roster.</p>;
  }

  return (
    <div className="tablewrap">
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <Th label="Name" sortKey="name" sort={sort} onToggle={toggle} />
              <Th label="Consent & release" sortKey="consent" sort={sort} onToggle={toggle} />
              <Th label="Screening" sortKey="screening" sort={sort} onToggle={toggle} />
              <Th label="Training" sortKey="training" sort={sort} onToggle={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.personId}>
                <td>
                  <Link href={`/people/${row.personId}`}>{row.name}</Link>
                </td>
                <td>
                  <StatusBadge
                    status={row.consent == null ? null : row.consent ? "green" : "blue"}
                    label={row.consent == null ? "Not linked" : row.consent ? "Signed" : "Not signed"}
                  />
                </td>
                <td>
                  <StatusBadge status={row.screeningStatus} />
                  {row.screeningText && row.screeningStatus !== "green" && (
                    <div className="text-sm text-[var(--muted)]">{row.screeningText}</div>
                  )}
                </td>
                <td>
                  <StatusBadge status={row.trainingStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

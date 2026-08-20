"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PART_STATUSES, PRIORITY_MAP, STATUS_MAP, STATUS_TONE } from "@/lib/types";
import type { PartPriority, PartStatus } from "@/lib/types";

export type ShopPart = {
  id: string;
  fullPartNumber: string;
  partNumber: number;
  type: "part" | "assembly";
  name: string;
  status: PartStatus;
  priority: PartPriority;
};

const POLL_MS = 10_000;

function priorityClass(priority: PartPriority): string {
  return `priority-${priority === 0 ? "high" : priority === 1 ? "normal" : "low"}`;
}

/** Student+ shop board (issue #11): server-rendered initial parts (matches the
 * WhosHere pattern), then polls /api/shop/[projectId] every 10s — no
 * websockets, no visibility pause, it's a TV. Keeps last good data on a
 * failed refresh instead of blanking mid-shift. Tiles link to the part
 * detail page (now that only student+ viewers ever see them). */
export function ShopBoard({ projectId, initial }: { projectId: string; initial: ShopPart[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get("status");
  const statusFilter = (PART_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as PartStatus)
    : null;

  const [parts, setParts] = useState<ShopPart[]>(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/shop/${projectId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { parts: ShopPart[] };
        setParts(json.parts);
      } catch {
        // A blip shouldn't blank the TV — keep showing the last good data.
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [projectId]);

  function onFilterChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set("status", value);
    else params.delete("status");
    router.replace(`?${params.toString()}`);
  }

  const statuses = PART_STATUSES.filter((s) => (statusFilter ? s === statusFilter : s !== "done"));

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-wrap items-center gap-3">
        <label className="label" htmlFor="shop-status-filter" style={{ marginBottom: 0 }}>
          Status
        </label>
        <select
          id="shop-status-filter"
          className="input"
          style={{ width: "auto" }}
          value={statusFilter ?? ""}
          onChange={(e) => onFilterChange(e.target.value)}
        >
          <option value="">All</option>
          {PART_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_MAP[s]}</option>
          ))}
        </select>
      </div>

      {parts.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No parts yet.</p>
      ) : (
        statuses.map((status) => {
          const rows = parts
            .filter((p) => p.status === status)
            .sort((a, b) => a.priority - b.priority || a.partNumber - b.partNumber);
          if (rows.length === 0) return null;
          return (
            <section key={status} className="card">
              <div className="card-head">
                <h3 className={`status-${STATUS_TONE[status]}`}>{STATUS_MAP[status]}</h3>
                <span className="count">{rows.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {rows.map((p) => (
                  <Link
                    key={p.id}
                    href={`/admin/parts/${p.id}`}
                    title={p.name}
                    className={`shop-tile ${priorityClass(p.priority)}`}
                  >
                    <div className="mono font-semibold">{p.fullPartNumber}</div>
                    <div className="shop-tile-name">{p.name}</div>
                    <div className="shop-tile-priority">{PRIORITY_MAP[p.priority]}</div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

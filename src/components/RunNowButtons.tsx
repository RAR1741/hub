"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SYNC_SOURCES } from "@/lib/sync-runs";

type RowState = { busy: boolean; error: string | null };

const DEFAULT_ROW: RowState = { busy: false, error: null };

export function RunNowButtons() {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const router = useRouter();

  function setRow(source: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [source]: { ...(prev[source] ?? DEFAULT_ROW), ...patch },
    }));
  }

  async function run(source: string, endpoint: string) {
    setRow(source, { busy: true, error: null });
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRow(source, { busy: false, error: null });
      } else {
        setRow(source, { busy: false, error: body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setRow(source, { busy: false, error: e instanceof Error ? e.message : "Request failed." });
    }
    router.push(`/admin/sync-runs?source=${source}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {SYNC_SOURCES.map(({ source, label, endpoint }) => {
          const row = rows[source];
          return (
            <button
              key={source}
              type="button"
              className="btn"
              disabled={row?.busy}
              onClick={() => run(source, endpoint)}
            >
              {row?.busy ? `Running ${label}…` : `Run ${label}`}
            </button>
          );
        })}
      </div>
      {Object.entries(rows).map(([source, row]) =>
        row.error ? (
          <p key={source} role="status" className="text-sm text-[var(--red)]">
            {SYNC_SOURCES.find((s) => s.source === source)?.label}: {row.error}
          </p>
        ) : null,
      )}
    </div>
  );
}

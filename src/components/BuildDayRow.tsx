"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function BuildDayRow({
  date,
  kind,
  source,
}: {
  date: string;
  kind: "required" | "optional";
  source: "gcal" | "manual";
}) {
  const [k, setK] = useState(kind);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/build-days/${date}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: k }),
      });
      if (res.ok) router.refresh();
      else setStatus("Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the build day on ${date}?`)) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/build-days/${date}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setStatus("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="mono">{date}</td>
      <td>
        <select
          className="input w-auto"
          aria-label={`Kind for ${date}`}
          value={k}
          onChange={(e) => setK(e.target.value as "required" | "optional")}
        >
          <option value="required">required</option>
          <option value="optional">optional</option>
        </select>
      </td>
      <td>
        <span className={`pill ${source === "manual" ? "on" : "role"}`}>
          {source === "manual" ? "Manual" : "Google"}
        </span>
      </td>
      <td>
        <div className="rowacts">
          <button onClick={save} className="btn icon" aria-label={`Save ${date}`} disabled={busy || k === kind}>
            <Icon name="check" />
          </button>
          <button onClick={remove} className="btn icon danger" aria-label={`Delete ${date}`} disabled={busy}>
            <Icon name="trash" />
          </button>
        </div>
        {status && <div role="status" className="text-sm text-[var(--muted)]">{status}</div>}
      </td>
    </tr>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tool, ToolStatus } from "@/lib/types";

const STATUSES: ToolStatus[] = ["in_service", "needs_attention", "out_of_service", "retired"];

/** Create + edit (`initial?: Tool`), full-replace like `updateEvent`/`BatteryForm`. */
export function ToolForm({ initial }: { initial?: Tool }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [assetTag, setAssetTag] = useState(initial?.assetTag ?? "");
  const [status, setStatus] = useState<ToolStatus>(initial?.status ?? "in_service");
  const [maintenanceIntervalDays, setMaintenanceIntervalDays] = useState(
    initial?.maintenanceIntervalDays?.toString() ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(initial ? `/api/tools/${initial.id}` : "/api/tools", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: category || null,
          location: location || null,
          assetTag: assetTag || null,
          status,
          maintenanceIntervalDays: maintenanceIntervalDays ? Number(maintenanceIntervalDays) : null,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        if (!initial) {
          setName("");
          setCategory("");
          setLocation("");
          setAssetTag("");
          setMaintenanceIntervalDays("");
          setNotes("");
        }
        router.refresh();
      } else if (res.status === 409) {
        setError("Asset tag already exists.");
      } else {
        setError(initial ? "Could not save changes — check the fields." : "Could not create the tool — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
      <label className="label">Category (optional)<input className="input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} /></label>
      <label className="label">Location (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80} /></label>
      <label className="label">Asset tag (optional)<input className="input" value={assetTag} onChange={(e) => setAssetTag(e.target.value)} maxLength={40} /></label>
      <label className="label">Maintenance interval, days (optional)<input className="input" type="number" value={maintenanceIntervalDays} onChange={(e) => setMaintenanceIntervalDays(e.target.value)} min={1} max={3650} /></label>
      <label className="label">Notes (optional)<input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      {initial && (
        <label className="label">Status
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ToolStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : initial ? "Save changes" : "Create tool"}
      </button>
    </form>
  );
}

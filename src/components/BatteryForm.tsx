"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Battery } from "@/lib/types";

/** Create + edit (`initial?: Battery`), full-replace like `updateEvent`. */
export function BatteryForm({ initial }: { initial?: Battery }) {
  const router = useRouter();
  const [number, setNumber] = useState(initial?.number ?? "");
  const [yearAcquired, setYearAcquired] = useState(initial?.yearAcquired?.toString() ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serialDateCode, setSerialDateCode] = useState(initial?.serialDateCode ?? "");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [tradeName, setTradeName] = useState(initial?.tradeName ?? "");
  const [ampHourRating, setAmpHourRating] = useState(initial?.ampHourRating?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState<"active" | "retired">(initial?.status ?? "active");
  const [retiredAt, setRetiredAt] = useState(initial?.retiredAt ? initial.retiredAt.slice(0, 10) : "");
  const [retiredReason, setRetiredReason] = useState(initial?.retiredReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(initial ? `/api/batteries/${initial.id}` : "/api/batteries", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number,
          yearAcquired: yearAcquired ? Number(yearAcquired) : null,
          model: model || null,
          serialDateCode: serialDateCode || null,
          manufacturer: manufacturer || null,
          tradeName: tradeName || null,
          ampHourRating: ampHourRating ? Number(ampHourRating) : null,
          notes: notes || null,
          status,
          retiredAt: status === "retired" && retiredAt ? new Date(retiredAt).toISOString() : null,
          retiredReason: retiredReason || null,
        }),
      });
      if (res.ok) {
        if (!initial) {
          setNumber("");
          setYearAcquired("");
          setModel("");
          setSerialDateCode("");
          setManufacturer("");
          setTradeName("");
          setAmpHourRating("");
          setNotes("");
        }
        router.refresh();
      } else if (res.status === 409) {
        setError("Number already exists.");
      } else {
        setError(initial ? "Could not save changes — check the fields." : "Could not create the battery — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Number<input className="input" value={number} onChange={(e) => setNumber(e.target.value)} required maxLength={20} /></label>
      <label className="label">Year acquired (optional)<input className="input" type="number" value={yearAcquired} onChange={(e) => setYearAcquired(e.target.value)} min={1990} max={2100} /></label>
      <label className="label">Model (optional)<input className="input" value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} /></label>
      <label className="label">Serial/date code (optional)<input className="input" value={serialDateCode} onChange={(e) => setSerialDateCode(e.target.value)} maxLength={80} /></label>
      <label className="label">Manufacturer (optional)<input className="input" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} maxLength={80} /></label>
      <label className="label">Trade name (optional)<input className="input" value={tradeName} onChange={(e) => setTradeName(e.target.value)} maxLength={80} /></label>
      <label className="label">Amp-hour rating (optional)<input className="input" type="number" step="any" value={ampHourRating} onChange={(e) => setAmpHourRating(e.target.value)} min={0} max={1000} /></label>
      <label className="label">Notes (optional)<input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      {initial && (
        <>
          <label className="label">Status
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as "active" | "retired")}>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          {status === "retired" && (
            <>
              <label className="label">Retired at<input className="input" type="date" value={retiredAt} onChange={(e) => setRetiredAt(e.target.value)} /></label>
              <label className="label">Retired reason (optional)<input className="input" value={retiredReason} onChange={(e) => setRetiredReason(e.target.value)} maxLength={500} /></label>
            </>
          )}
        </>
      )}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : initial ? "Save changes" : "Create battery"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Battery } from "@/lib/types";

function nowDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Log a usage row. `batteries` is already LRU-ordered, active only (§6). */
export function UsageLogForm({ batteries }: { batteries: Battery[] }) {
  const router = useRouter();
  const [batteryId, setBatteryId] = useState(batteries[0]?.id ?? "");
  const [usedAt, setUsedAt] = useState(nowDatetimeLocal());
  const [eventKey, setEventKey] = useState("");
  const [matchKey, setMatchKey] = useState("");
  const [hadProblem, setHadProblem] = useState(false);
  const [problemDescription, setProblemDescription] = useState("");
  const [wiggleTestOk, setWiggleTestOk] = useState("");
  const [chargerTestOk, setChargerTestOk] = useState("");
  const [rintOhms, setRintOhms] = useState("");
  const [chargePrePct, setChargePrePct] = useState("");
  const [chargePostPct, setChargePostPct] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function triState(v: string): boolean | null {
    if (v === "yes") return true;
    if (v === "no") return false;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/battery-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batteryId,
          usedAt: usedAt ? new Date(usedAt).toISOString() : undefined,
          eventKey: eventKey || null,
          matchKey: matchKey || null,
          hadProblem,
          problemDescription: hadProblem ? problemDescription || null : null,
          wiggleTestOk: triState(wiggleTestOk),
          chargerTestOk: triState(chargerTestOk),
          rintOhms: rintOhms ? Number(rintOhms) : null,
          chargePrePct: chargePrePct ? Number(chargePrePct) : null,
          chargePostPct: chargePostPct ? Number(chargePostPct) : null,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        setUsedAt(nowDatetimeLocal());
        setEventKey("");
        setMatchKey("");
        setHadProblem(false);
        setProblemDescription("");
        setWiggleTestOk("");
        setChargerTestOk("");
        setRintOhms("");
        setChargePrePct("");
        setChargePostPct("");
        setNotes("");
        router.refresh();
      } else {
        setError("Could not log this entry — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (batteries.length === 0) {
    return <p className="card text-sm text-[var(--muted)]">No active batteries to log against.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Battery
        <select className="input" value={batteryId} onChange={(e) => setBatteryId(e.target.value)} required>
          {batteries.map((b) => <option key={b.id} value={b.id}>{b.number}{b.model ? ` — ${b.model}` : ""}</option>)}
        </select>
      </label>
      <label className="label">Used at<input className="input" type="datetime-local" value={usedAt} onChange={(e) => setUsedAt(e.target.value)} required /></label>
      <label className="label">Event key (optional)<input className="input" value={eventKey} onChange={(e) => setEventKey(e.target.value)} maxLength={20} placeholder="2026incol" /></label>
      <label className="label">Match (optional)<input className="input" value={matchKey} onChange={(e) => setMatchKey(e.target.value)} maxLength={20} placeholder="qm1" /></label>
      <label className="label flex items-center gap-2">
        <input type="checkbox" checked={hadProblem} onChange={(e) => setHadProblem(e.target.checked)} /> Had a problem
      </label>
      {hadProblem && (
        <label className="label">Problem description<input className="input" value={problemDescription} onChange={(e) => setProblemDescription(e.target.value)} maxLength={1000} /></label>
      )}
      <label className="label">Wiggle test
        <select className="input" value={wiggleTestOk} onChange={(e) => setWiggleTestOk(e.target.value)}>
          <option value="">— Not recorded —</option>
          <option value="yes">Good</option>
          <option value="no">Bad</option>
        </select>
      </label>
      <label className="label">Charger test
        <select className="input" value={chargerTestOk} onChange={(e) => setChargerTestOk(e.target.value)}>
          <option value="">— Not recorded —</option>
          <option value="yes">Good</option>
          <option value="no">Bad</option>
        </select>
      </label>
      <label className="label">Rint (ohms, optional)<input className="input" type="number" step="any" value={rintOhms} onChange={(e) => setRintOhms(e.target.value)} min={0} max={10} /></label>
      <label className="label">Charge % before (optional)<input className="input" type="number" value={chargePrePct} onChange={(e) => setChargePrePct(e.target.value)} min={0} /></label>
      <label className="label">Charge % after (optional)<input className="input" type="number" value={chargePostPct} onChange={(e) => setChargePostPct(e.target.value)} min={0} /></label>
      <label className="label">Notes (optional)<input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Logging…" : "Log usage"}
      </button>
    </form>
  );
}

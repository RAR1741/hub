"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Period } from "@/lib/types";

type GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string };

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({ periods }: { periods: Period[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<GcalCandidate[]>([]);
  const [gcalEventId, setGcalEventId] = useState("");

  useEffect(() => {
    fetch("/api/admin/events/gcal-candidates")
      .then((res) => (res.ok ? res.json() : { candidates: [] }))
      .then((json) => setCandidates(json.candidates ?? []))
      .catch(() => setCandidates([]));
  }, []);

  function pickCandidate(id: string) {
    setGcalEventId(id);
    if (!id) {
      setName("");
      setStartsAt("");
      setEndsAt("");
      return;
    }
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate) return;
    setName(candidate.title);
    setStartsAt(toDatetimeLocal(candidate.startsAt));
    setEndsAt(toDatetimeLocal(candidate.endsAt));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          periodId,
          location: location || null,
          description: description || null,
          startsAt: startsAt ? new Date(startsAt).toISOString() : "",
          endsAt: endsAt ? new Date(endsAt).toISOString() : "",
          gcalEventId: gcalEventId || null,
        }),
      });
      if (res.ok) {
        setName("");
        setLocation("");
        setDescription("");
        setStartsAt("");
        setEndsAt("");
        setGcalEventId("");
        router.refresh();
      } else {
        setError("Could not create the event — check the dates and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const linked = gcalEventId !== "";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {candidates.length > 0 && (
        <label className="label">Attach to a calendar event (optional)
          <select className="input" value={gcalEventId} onChange={(e) => pickCandidate(e.target.value)}>
            <option value="">— Not linked —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({new Date(c.startsAt).toLocaleString()})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required disabled={linked} /></label>
      <label className="label">Period
        <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="label">Location (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Starts<input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required disabled={linked} /></label>
      <label className="label">Ends<input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required disabled={linked} /></label>
      {linked && <p className="text-sm text-[var(--muted)]">Name/dates are synced from Google Calendar and will update automatically.</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">{busy ? "Saving…" : "Create event"}</button>
    </form>
  );
}

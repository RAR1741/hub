"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Event, Period } from "@/lib/types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function EventForm({ periods, event, onSaved }: { periods: Period[]; event?: Event; onSaved?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(event?.name ?? "");
  const [periodId, setPeriodId] = useState(event?.periodId ?? periods[0]?.id ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startsAt, setStartsAt] = useState(event ? toLocalInput(event.startsAt) : "");
  const [endsAt, setEndsAt] = useState(event ? toLocalInput(event.endsAt) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(event ? `/api/admin/events/${event.id}` : "/api/admin/events", {
        method: event ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          periodId,
          location: location || null,
          description: description || null,
          startsAt: startsAt ? new Date(startsAt).toISOString() : "",
          endsAt: endsAt ? new Date(endsAt).toISOString() : "",
        }),
      });
      if (res.ok) {
        if (!event) {
          setName("");
          setLocation("");
          setDescription("");
          setStartsAt("");
          setEndsAt("");
        }
        router.refresh();
        onSaved?.();
      } else {
        setError(event ? "Could not save changes — check the dates and try again." : "Could not create the event — check the dates and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="label">Period
        <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="label">Location (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="label">Description (optional)<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label">Starts<input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
      <label className="label">Ends<input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : event ? "Save changes" : "Create event"}
      </button>
    </form>
  );
}

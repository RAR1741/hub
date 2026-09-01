"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { datetimeLocalToInstant, instantToDatetimeLocal } from "@/lib/tz";
import type { Event, Period } from "@/lib/types";

type GcalCandidate = { id: string; title: string; startsAt: string; endsAt: string };

export function EventForm({ periods: allPeriods, forms, event, teamTz, onSaved }: { periods: Period[]; forms: { id: string; title: string }[]; event?: Event; teamTz: string; onSaved?: () => void }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const periods = allPeriods.filter((p) => p.endsOn >= today || p.id === event?.periodId);
  const [name, setName] = useState(event?.name ?? "");
  const [periodId, setPeriodId] = useState(event?.periodId ?? periods[0]?.id ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startsAt, setStartsAt] = useState(event ? instantToDatetimeLocal(event.startsAt, teamTz) : "");
  const [endsAt, setEndsAt] = useState(event ? instantToDatetimeLocal(event.endsAt, teamTz) : "");
  const [formId, setFormId] = useState(event?.formId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<GcalCandidate[]>([]);
  const [gcalEventId, setGcalEventId] = useState(event?.gcalEventId ?? "");

  const loadCandidates = useCallback(() => {
    // Editing a linked event: exclude its OWN claim so the calendar event
    // it's already linked to still shows up as a selectable candidate,
    // instead of being filtered out as "claimed by another event."
    const url = event
      ? `/api/admin/events/gcal-candidates?excludeEventId=${event.id}`
      : "/api/admin/events/gcal-candidates";
    fetch(url)
      .then((res) => (res.ok ? res.json() : { candidates: [] }))
      .then((json) => setCandidates(json.candidates ?? []))
      .catch(() => setCandidates([]));
  }, [event]);

  useEffect(() => loadCandidates(), [loadCandidates]);

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
    setStartsAt(instantToDatetimeLocal(candidate.startsAt, teamTz));
    setEndsAt(instantToDatetimeLocal(candidate.endsAt, teamTz));
  }

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
          startsAt: startsAt ? datetimeLocalToInstant(startsAt, teamTz) : "",
          endsAt: endsAt ? datetimeLocalToInstant(endsAt, teamTz) : "",
          gcalEventId: gcalEventId || null,
          formId: formId || null,
        }),
      });
      if (res.ok) {
        if (!event) {
          setName("");
          setLocation("");
          setDescription("");
          setStartsAt("");
          setEndsAt("");
          setGcalEventId("");
          loadCandidates(); // drop the just-attached calendar event from the picker
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

  const linked = gcalEventId !== "";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {candidates.length > 0 && (
        <label className="label">Attach to a calendar event (optional)
          <select className="input" value={gcalEventId} onChange={(e) => pickCandidate(e.target.value)}>
            <option value="">— Not linked —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({new Date(c.startsAt).toLocaleString(undefined, { timeZone: teamTz })})
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
      <label className="label">Sign-up form (optional)
        <select className="input" value={formId} onChange={(e) => setFormId(e.target.value)}>
          <option value="">— No form —</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
      </label>
      {linked && <p className="text-sm text-[var(--muted)]">Name/dates are synced from Google Calendar and will update automatically.</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : event ? "Save changes" : "Create event"}
      </button>
    </form>
  );
}

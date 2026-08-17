"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RosterEntry } from "@/lib/event-signups";

export function EventRosterActions({ eventId, entry }: { eventId: string; entry: RosterEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function checkIn() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: entry.personId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uncheck() {
    if (!entry.sessionId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/checkin?sessionId=${encodeURIComponent(entry.sessionId)}`,
        { method: "DELETE" },
      );
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return entry.checkedIn ? (
    <button disabled={busy} onClick={uncheck} className="btn btn-secondary px-3 py-1">
      {busy ? "Working…" : "Undo check-in"}
    </button>
  ) : (
    <button disabled={busy} onClick={checkIn} className="btn btn-primary px-3 py-1">
      {busy ? "Working…" : "Check in"}
    </button>
  );
}

export function ManualAddPerson({
  eventId,
  people,
}: {
  eventId: string;
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!personId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (people.length === 0) return null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <span className="font-semibold">Add someone who didn&apos;t sign up:</span>
      <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button disabled={busy} onClick={add} className="btn btn-primary px-3 py-1">
        {busy ? "Working…" : "Add & check in"}
      </button>
    </div>
  );
}

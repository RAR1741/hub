"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RosterEntry } from "@/lib/event-signups";
import { Button } from "@/components/ui";

export function EventRosterActions({ eventId, entry }: { eventId: string; entry: RosterEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function checkIn() {
    setBusy(true);
    try {
      await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: entry.personId }),
      });
      // Refresh even on a non-2xx (e.g. 409 someone else already checked
      // them in) — the roster should reflect whatever the server now has.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uncheck() {
    if (!entry.sessionId) return;
    setBusy(true);
    try {
      await fetch(
        `/api/admin/events/${eventId}/checkin?sessionId=${encodeURIComponent(entry.sessionId)}`,
        { method: "DELETE" },
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return entry.checkedIn ? (
    <Button
      variant="secondary"
      className="px-3 py-1"
      onClick={uncheck}
      pending={busy}
      pendingLabel="Working…"
    >
      Undo check-in
    </Button>
  ) : (
    <Button
      variant="primary"
      className="px-3 py-1"
      onClick={checkIn}
      pending={busy}
      pendingLabel="Working…"
    >
      Check in
    </Button>
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
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `people` shrinks after a successful add (router.refresh()); if the
  // stored selection fell out of the list, fall back to the first option
  // rather than stashing a stale id in state.
  const personId = selected && people.some((p) => p.id === selected) ? selected : (people[0]?.id ?? "");

  async function add() {
    if (!personId) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (people.length === 0) return null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <span className="font-semibold" id="manual-add-label">Add someone who didn&apos;t sign up:</span>
      <select
        className="input"
        aria-labelledby="manual-add-label"
        value={personId}
        onChange={(e) => setSelected(e.target.value)}
      >
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button
        variant="primary"
        className="px-3 py-1"
        onClick={add}
        pending={busy}
        pendingLabel="Working…"
      >
        Add & check in
      </Button>
    </div>
  );
}

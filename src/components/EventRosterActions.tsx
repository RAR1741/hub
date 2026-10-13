"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RosterEntry } from "@/lib/event-signups";
import { formatInstant } from "@/lib/tz";
import { Button } from "@/components/ui";

const NOTE_MAX = 500;

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

export function EventRosterNote({
  eventId,
  entry,
  teamTz,
}: {
  eventId: string;
  entry: RosterEntry;
  teamTz: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="px-3 py-1" onClick={() => setOpen(true)}>
        {entry.note ? "Edit note" : "Add note"}
      </Button>
      {open && (
        <NoteModal eventId={eventId} entry={entry} teamTz={teamTz} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function NoteModal({
  eventId,
  entry,
  teamTz,
  onClose,
}: {
  eventId: string;
  entry: RosterEntry;
  teamTz: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState(entry.note?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: entry.personId, note: body }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Note for ${entry.name}`}
      onClick={onClose}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Note for {entry.name}</h3>
            {entry.note && (
              <p className="mt-1 text-sm text-[var(--muted)]">
                Last edited by {entry.note.updatedByName} · {formatInstant(entry.note.updatedAt, teamTz)}
              </p>
            )}
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={save} className="flex flex-col gap-2 mt-3">
          <label className="label">
            Note
            <textarea
              ref={textareaRef}
              className="input"
              maxLength={NOTE_MAX}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(false);
              }}
            />
          </label>
          <p className="text-sm text-[var(--muted)]">Leave empty to remove the note.</p>
          <Button type="submit" variant="primary" className="w-full" pending={busy} pendingLabel="Saving…">
            Save
          </Button>
          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
              Something went wrong — try again.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

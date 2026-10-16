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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;

  // `people` shrinks after a successful add (router.refresh()); a selection
  // that fell out of the list counts as unselected.
  const personId = selected && people.some((p) => p.id === selected) ? selected : "";

  function select(p: { id: string; name: string }) {
    setSelected(p.id);
    setQuery(p.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActive((a) => (a < 0 ? (step === 1 ? 0 : filtered.length - 1) : (a + step + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[active] ?? (filtered.length === 1 ? filtered[0] : undefined);
      if (open && pick) select(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  async function add() {
    if (!personId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      router.refresh();
      if (res.ok) {
        setQuery("");
        setSelected(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (people.length === 0) return null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <span className="font-semibold" id="manual-add-label">Add someone who didn&apos;t sign up:</span>
      <div className="relative w-72 max-w-full">
        <input
          type="text"
          role="combobox"
          className="input"
          aria-labelledby="manual-add-label"
          aria-expanded={open}
          aria-controls="manual-add-list"
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `manual-add-opt-${filtered[active].id}` : undefined}
          autoComplete="off"
          placeholder="Search by name…"
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setActive(-1);
            setOpen(true);
          }}
        />
        <ul
          id="manual-add-list"
          role="listbox"
          aria-labelledby="manual-add-label"
          hidden={!open}
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-[var(--hair)] bg-[var(--surface)] py-1 text-sm shadow-lg"
        >
          {filtered.length === 0 ? (
            <li role="status" className="px-3 py-2 text-[var(--muted)]">No matches</li>
          ) : (
            filtered.map((p, i) => (
              <li
                key={p.id}
                id={`manual-add-opt-${p.id}`}
                role="option"
                aria-selected={p.id === personId}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-[var(--surface-2)]" : ""} ${p.id === personId ? "font-semibold" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(p);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {p.name}
              </li>
            ))
          )}
        </ul>
      </div>
      <Button
        variant="primary"
        className="px-3 py-1"
        disabled={!personId}
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Mount-only (onClose lives in a ref) so a parent re-render never re-steals focus.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null; // the Add/Edit button that opened us
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab") return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, [href], input, select");
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, []);

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
      <div ref={dialogRef} className="modal-card" onClick={(e) => e.stopPropagation()}>
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

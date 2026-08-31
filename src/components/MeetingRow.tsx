"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { instantToDatetimeLocal, datetimeLocalToInstant } from "@/lib/tz";

export function MeetingRow({
  id,
  title,
  startsAt,
  endsAt,
  isManual,
  teamTz,
}: {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isManual: boolean;
  teamTz: string;
}) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(title);
  const [starts, setStarts] = useState(instantToDatetimeLocal(startsAt, teamTz));
  const [ends, setEnds] = useState(instantToDatetimeLocal(endsAt, teamTz));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/meetings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          startsAt: starts ? datetimeLocalToInstant(starts, teamTz) : "",
          endsAt: ends ? datetimeLocalToInstant(ends, teamTz) : "",
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setStatus("Save failed — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the meeting "${title}"?`)) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/meetings/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setStatus("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <div className="flex flex-wrap items-end gap-3 py-1">
            <label className="label">
              Title <input className="input" value={t} onChange={(e) => setT(e.target.value)} />
            </label>
            <label className="label">
              Starts{" "}
              <input
                className="input"
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
            </label>
            <label className="label">
              Ends{" "}
              <input
                className="input"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </label>
            <Button variant="primary" onClick={save} pending={busy} pendingLabel="Saving…">
              Save
            </Button>
            <button onClick={() => setEditing(false)} className="btn" disabled={busy}>
              Cancel
            </button>
            {status && <span role="status" className="text-sm text-[var(--muted)]">{status}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{title}</td>
      <td>{new Date(startsAt).toLocaleString("en-US", { timeZone: teamTz })}</td>
      <td>{new Date(endsAt).toLocaleString("en-US", { timeZone: teamTz })}</td>
      <td>
        <span className={`pill ${isManual ? "on" : "role"}`}>{isManual ? "Manual" : "Google"}</span>
      </td>
      <td>
        <div className="rowacts">
          <button onClick={() => setEditing(true)} className="btn icon" aria-label={`Edit ${title}`}>
            <Icon name="edit" />
          </button>
          <button onClick={remove} className="btn icon danger" aria-label={`Delete ${title}`} disabled={busy}>
            <Icon name="trash" />
          </button>
        </div>
        {status && <div role="status" className="text-sm text-[var(--muted)]">{status}</div>}
      </td>
    </tr>
  );
}

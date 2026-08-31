"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local wants YYYY-MM-DDTHH:mm in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionEditRow({
  id, timeIn, timeOut, note, excluded, label,
}: {
  id: string; timeIn: string; timeOut: string | null; note: string | null;
  excluded: boolean; label: string;
}) {
  const [tin, setTin] = useState(toLocalInput(timeIn));
  const [tout, setTout] = useState(toLocalInput(timeOut));
  const [n, setN] = useState(note ?? "");
  const [exc, setExc] = useState(excluded);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Computed hours for this session, live from the (possibly edited) in/out.
  // Blank for an open session (no clock-out). Matches sessionHours: end - start.
  const hours = tin && tout
    ? Math.max(0, (new Date(tout).getTime() - new Date(tin).getTime()) / 3_600_000)
    : null;

  async function save() {
    setStatus(null);
    if (!tin) { setStatus("Time in is required."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeIn: new Date(tin).toISOString(),
          timeOut: tout ? new Date(tout).toISOString() : null,
          note: n || undefined,
          excludedFromTotals: exc,
        }),
      });
      if (res.ok) { setStatus("Saved."); router.refresh(); }
      else setStatus("Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete this session for ${label}?`)) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setStatus("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{label}</td>
      <td><input className="input w-48" type="datetime-local" aria-label={`Time in for ${label}`} value={tin} onChange={(e) => setTin(e.target.value)} /></td>
      <td><input className="input w-48" type="datetime-local" aria-label={`Time out for ${label}`} value={tout} onChange={(e) => setTout(e.target.value)} /></td>
      <td className="mono" aria-label={`Hours for ${label}`}>{hours === null ? "—" : hours.toFixed(2)}</td>
      <td><input className="input w-36" aria-label={`Note for ${label}`} value={n} onChange={(e) => setN(e.target.value)} placeholder="note" /></td>
      <td><input type="checkbox" aria-label={`Exclude ${label} from totals`} checked={exc} onChange={(e) => setExc(e.target.checked)} /></td>
      <td className="flex items-center gap-2">
        <Button variant="primary" className="px-3 py-1" onClick={save} pending={busy} pendingLabel="Saving…">Save</Button>
        <Button variant="danger" className="px-3 py-1" onClick={remove} pending={busy} pendingLabel="Deleting…">Delete</Button>
        {status && <span role="status" className="text-sm text-[var(--color-muted-fg)]"> {status}</span>}
      </td>
    </tr>
  );
}

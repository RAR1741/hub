"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  async function save() {
    setStatus(null);
    if (!tin) { setStatus("Time in is required."); return; }
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
  }
  async function remove() {
    if (!confirm(`Delete this session for ${label}?`)) return;
    const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setStatus("Delete failed.");
  }

  return (
    <tr>
      <td>{label}</td>
      <td><input type="datetime-local" value={tin} onChange={(e) => setTin(e.target.value)} /></td>
      <td><input type="datetime-local" value={tout} onChange={(e) => setTout(e.target.value)} /></td>
      <td><input value={n} onChange={(e) => setN(e.target.value)} placeholder="note" /></td>
      <td><input type="checkbox" checked={exc} onChange={(e) => setExc(e.target.checked)} /></td>
      <td>
        <button onClick={save}>Save</button>{" "}
        <button onClick={remove}>Delete</button>
        {status && <span role="status"> {status}</span>}
      </td>
    </tr>
  );
}

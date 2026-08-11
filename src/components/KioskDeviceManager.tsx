"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function KioskDeviceManager({
  devices,
}: {
  devices: { id: string; name: string; lastSeenAt: string | null }[];
}) {
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function create() {
    if (creating) return;
    setCreating(true);
    setStatus(null); setNewToken(null);
    try {
      const res = await fetch("/api/admin/kiosk-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const { token } = (await res.json()) as { token: string };
        setNewToken(token);
        setName("");
        router.refresh();
      } else setStatus("Create failed.");
    } finally {
      setCreating(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this kiosk device? Tablets using it will stop working.")) return;
    const res = await fetch(`/api/admin/kiosk-devices/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setStatus("Delete failed.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="label">New device name <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button disabled={creating || !name.trim()} onClick={create} className="btn btn-primary">
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
      {newToken && (
        <p role="status" className="text-sm text-[var(--color-muted-fg)]">
          Token (shown once — enter it on the tablet at <code>/kiosk/setup</code>):{" "}
          <code>{newToken}</code>
        </p>
      )}
      {status && <p role="alert" className="text-sm text-[var(--color-absent)]">{status}</p>}
      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {d.name} — last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}
            </span>
            <button onClick={() => remove(d.id)} className="btn btn-danger">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

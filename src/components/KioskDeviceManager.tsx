"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

function DeviceRow({
  device,
  onFailed,
}: {
  device: { id: string; name: string; lastSeenAt: string | null };
  onFailed: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const router = useRouter();

  async function rename() {
    if (!name.trim()) return;
    const res = await fetch(`/api/admin/kiosk-devices/${device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else onFailed("Rename failed.");
  }

  async function remove() {
    if (!confirm("Delete this kiosk device? Tablets using it will stop working.")) return;
    const res = await fetch(`/api/admin/kiosk-devices/${device.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else onFailed("Delete failed.");
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      {editing ? (
        <span className="flex flex-1 items-center gap-2">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Rename ${device.name}`}
          />
          <button onClick={rename} className="btn btn-primary px-3 py-1">
            Save
          </button>
          <button onClick={() => { setEditing(false); setName(device.name); }} className="btn px-3 py-1">
            Cancel
          </button>
        </span>
      ) : (
        <span>
          {device.name} — last seen{" "}
          {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}
        </span>
      )}
      {!editing && (
        <div className="rowacts">
          <button onClick={() => setEditing(true)} className="btn icon" aria-label={`Rename ${device.name}`}>
            <Icon name="edit" />
          </button>
          <button onClick={remove} className="btn icon danger" aria-label={`Delete ${device.name}`}>
            <Icon name="trash" />
          </button>
        </div>
      )}
    </li>
  );
}

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="label">New device name <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button disabled={creating || !name.trim()} onClick={create} className="btn btn-primary">
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
      {newToken && (
        <p role="status" className="text-sm text-[var(--muted)]">
          Token (shown once — enter it on the tablet at <code>/kiosk/setup</code>):{" "}
          <code>{newToken}</code>
        </p>
      )}
      {status && <p role="alert" className="text-sm text-[var(--absent)]">{status}</p>}
      <ul className="flex flex-col divide-y divide-[var(--hair)]">
        {devices.map((d) => (
          <DeviceRow key={d.id} device={d} onFailed={setStatus} />
        ))}
      </ul>
    </div>
  );
}

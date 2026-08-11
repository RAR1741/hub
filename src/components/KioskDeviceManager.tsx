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
    <div>
      <label>New device name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button disabled={creating || !name.trim()} onClick={create}>
        {creating ? "Creating…" : "Create"}
      </button>
      {newToken && (
        <p role="status">
          Token (shown once — enter it on the tablet at <code>/kiosk/setup</code>):{" "}
          <code>{newToken}</code>
        </p>
      )}
      {status && <p role="alert">{status}</p>}
      <ul>
        {devices.map((d) => (
          <li key={d.id}>
            {d.name} — last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}{" "}
            <button onClick={() => remove(d.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

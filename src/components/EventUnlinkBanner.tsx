"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventUnlinkBanner({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/unlink`, { method: "POST" });
      if (res.ok) router.refresh();
      else setError("Could not unlink the event — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: "var(--yellow)" }}>
      <p>Linked Google Calendar event was deleted. The event details below are unaffected — you can unlink and manage this event manually.</p>
      <button type="button" onClick={unlink} disabled={busy} className="btn btn-secondary mt-2">
        {busy ? "Unlinking…" : "Unlink from calendar"}
      </button>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
    </div>
  );
}

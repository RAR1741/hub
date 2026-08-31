"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EventDeleteButton({ eventId, eventName }: { eventId: string; eventName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteEvent() {
    const confirmed = window.confirm(
      `Permanently delete${eventName ? ` "${eventName}"` : " this event"}? This cannot be undone and will archive its Slack channel.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin/events");
        router.refresh();
      } else if (res.status === 409) {
        setError("Can't delete — this event has check-in history.");
      } else {
        setError("Could not delete the event — please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={deleteEvent} disabled={busy} className="btn btn-danger">
        {busy ? "Deleting…" : "Delete event"}
      </button>
      {error && <p role="status" className="text-sm text-[var(--red)]">{error}</p>}
    </div>
  );
}

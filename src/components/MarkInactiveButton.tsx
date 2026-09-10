"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkInactiveButton({ personId, name }: { personId: string; name: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function markInactive() {
    if (!confirm(`Mark ${name} as inactive? They'll drop off the roster and kiosk. You can reactivate them from their edit page.`)) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/people/${personId}/active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (res.ok || res.status === 404) {
        router.refresh();
      } else {
        setStatus("Couldn't mark inactive.");
      }
    } catch {
      setStatus("Couldn't mark inactive.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={markInactive} className="btn" disabled={busy}>
        {busy ? "Marking…" : "Mark inactive"}
      </button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </>
  );
}

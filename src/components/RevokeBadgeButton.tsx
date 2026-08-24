"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevokeBadgeButton({
  personId,
  badgeId,
}: {
  personId: string;
  badgeId: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function revoke() {
    if (!confirm("Revoke this badge?")) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${personId}/badges/${badgeId}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setStatus("Revoke failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={revoke} className="btn btn-secondary px-2 py-0.5 text-sm" disabled={busy}>
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {status && <span role="status" className="text-sm text-[var(--color-muted-fg)]">{status}</span>}
    </span>
  );
}

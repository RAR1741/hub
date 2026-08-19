"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteBadgeButton({ badgeId }: { badgeId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this badge? This removes it from everyone who holds it.")) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/badges/${badgeId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin/badges");
        router.refresh();
      } else {
        setStatus("Delete failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <p>
      <button onClick={remove} className="btn btn-danger" disabled={busy}>{busy ? "Deleting…" : "Delete badge"}</button>
      {status && <span role="status" className="text-sm text-[var(--color-muted-fg)]"> {status}</span>}
    </p>
  );
}

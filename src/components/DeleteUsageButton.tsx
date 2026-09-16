"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteUsageButton({ usageId }: { usageId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this usage log entry?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/battery-usage/${usageId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={remove} className="btn btn-danger px-3 py-1" disabled={busy}>{busy ? "Deleting…" : "Delete"}</button>
  );
}

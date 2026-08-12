"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ActivatePeriodButton({ periodId }: { periodId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function activate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/periods/${periodId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={activate} className="btn btn-primary" disabled={busy}>
      {busy ? "Activating…" : "Make active"}
    </button>
  );
}

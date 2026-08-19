"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export function ExitMasqueradeButton({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function exit() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/masquerade/exit", { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        setStatus("Failed to exit masquerade.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={exit} className="btn btn-secondary text-sm" disabled={busy}>
        <Icon name="x" /> {busy ? "Exiting…" : "Exit"}
      </button>
      {status && <span role="status" className="text-xs text-[var(--red-fg)]">{status}</span>}
    </>
  );
}

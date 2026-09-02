"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function GitHubDisconnectButton({ personId }: { personId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  async function disconnect() {
    if (!confirm("Disconnect this GitHub account?")) return;
    setFailed(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${personId}/github`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        className="px-2 py-0.5 text-sm"
        onClick={disconnect}
        pending={busy}
        pendingLabel="Disconnecting…"
      >
        Disconnect
      </Button>
      {failed && <span role="status" className="text-sm text-[var(--red)]">Disconnect failed.</span>}
    </span>
  );
}

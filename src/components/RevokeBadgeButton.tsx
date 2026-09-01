"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

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
      <Button
        variant="secondary"
        className="px-2 py-0.5 text-sm"
        onClick={revoke}
        pending={busy}
        pendingLabel="Revoking…"
      >
        Revoke
      </Button>
      {status && <span role="status" className="text-sm text-[var(--muted)]">{status}</span>}
    </span>
  );
}

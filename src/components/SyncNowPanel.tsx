"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncOutcome =
  | { kind: "ok"; groups: number }
  | { kind: "error"; message: string };

export function SyncNowPanel({ endpoint, noun }: { endpoint: string; noun: string }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const router = useRouter();

  async function sync() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        const groups = Object.values(body).find(Array.isArray)?.length ?? 0;
        setOutcome({ kind: "ok", groups });
        router.refresh();
      } else {
        setOutcome({ kind: "error", message: body?.error ?? `HTTP ${res.status}` });
      }
    } catch (error) {
      setOutcome({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={sync} className="btn btn-primary self-start" disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {outcome?.kind === "ok" && (
        <p className="text-sm text-[var(--muted)]">
          Sync complete — reconciled {outcome.groups} {noun}{outcome.groups === 1 ? "" : "s"}.
        </p>
      )}
      {outcome?.kind === "error" && (
        <p className="text-sm text-[var(--red)]">Sync failed: {outcome.message}</p>
      )}
    </div>
  );
}

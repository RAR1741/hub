"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncOutcome =
  | { kind: "ok"; matched: number; updated: number; unmatched: number }
  | { kind: "error"; message: string };

export function FirstSyncPanel() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const router = useRouter();

  async function sync() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/admin/first/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setOutcome({
          kind: "ok",
          matched: body.matched ?? 0,
          updated: body.updated ?? 0,
          unmatched: Array.isArray(body.unmatchedFirst) ? body.unmatchedFirst.length : 0,
        });
        router.refresh();
      } else if (body?.error === "session_expired") {
        setOutcome({ kind: "error", message: "FIRST session expired — re-paste the cookie above." });
      } else if (body?.error === "not_configured") {
        setOutcome({ kind: "error", message: "No FIRST session saved yet — paste the cookie above." });
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
          Synced — {outcome.matched} matched, {outcome.updated} updated, {outcome.unmatched} unmatched.
        </p>
      )}
      {outcome?.kind === "error" && (
        <p className="text-sm text-[var(--red)]">{outcome.message}</p>
      )}
    </div>
  );
}

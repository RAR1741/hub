"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveOutcome = { kind: "ok" } | { kind: "error"; message: string };

export function FirstSessionCard({ savedAt, expired }: { savedAt: string | null; expired?: boolean }) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const router = useRouter();

  async function save() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/admin/first/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setOutcome({ kind: "ok" });
        setCookie("");
        router.refresh();
      } else if (res.status === 400 && body?.error === "invalid_session") {
        setOutcome({ kind: "error", message: "That cookie didn't authenticate — copy a fresh one and try again." });
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
      <p className={savedAt && expired ? "text-sm text-[var(--red)]" : "text-sm"}>
        {savedAt
          ? expired
            ? "FIRST session expired — paste a fresh cookie to resume."
            : `FIRST session saved ${new Date(savedAt).toLocaleString()}. Re-paste when sync reports it expired.`
          : "No FIRST session saved — paste one to enable syncing."}
      </p>
      <p className="text-sm text-[var(--muted)]">
        In your browser, log into my.firstinspires.org, open DevTools → Network, click any
        my.firstinspires.org request, and copy the entire value of the request&rsquo;s Cookie header.
      </p>
      <textarea
        className="input"
        rows={3}
        placeholder="Paste the Cookie header value here…"
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
      />
      <button onClick={save} className="btn btn-primary self-start" disabled={busy || cookie.trim().length === 0}>
        {busy ? "Saving…" : "Save session"}
      </button>
      {outcome?.kind === "ok" && <p className="text-sm text-[var(--muted)]">Session saved.</p>}
      {outcome?.kind === "error" && <p className="text-sm text-[var(--red)]">{outcome.message}</p>}
    </div>
  );
}

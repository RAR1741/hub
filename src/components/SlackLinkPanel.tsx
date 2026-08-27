"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LinkReport = {
  linked: number;
  alreadyLinked: number;
  ambiguous: { email: string; personIds: string[] }[];
  unmatchedSlack: { id: string; email: string }[];
  unmatchedPeople: { personId: string; name: string }[];
};

type SyncOutcome =
  | { kind: "ok"; report: LinkReport }
  | { kind: "not_configured" }
  | { kind: "error"; message: string };

export function SlackLinkPanel() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const router = useRouter();

  async function sync() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/admin/slack/link-sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setOutcome({ kind: "ok", report: body as LinkReport });
        router.refresh();
      } else if (body?.error === "not_configured") {
        setOutcome({ kind: "not_configured" });
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
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-[var(--muted)]">
            Linked {outcome.report.linked}, already linked {outcome.report.alreadyLinked}, ambiguous{" "}
            {outcome.report.ambiguous.length}, unmatched Slack {outcome.report.unmatchedSlack.length}, unmatched
            people {outcome.report.unmatchedPeople.length}.
          </p>
          {outcome.report.ambiguous.length > 0 && (
            <ul className="list-disc pl-5 text-[var(--muted)]">
              {outcome.report.ambiguous.map((a) => (
                <li key={a.email}>
                  {a.email} matches {a.personIds.length} people
                </li>
              ))}
            </ul>
          )}
          {outcome.report.unmatchedSlack.length > 0 && (
            <ul className="list-disc pl-5 text-[var(--muted)]">
              {outcome.report.unmatchedSlack.map((m) => (
                <li key={m.id}>{m.email} (no matching person)</li>
              ))}
            </ul>
          )}
          {outcome.report.unmatchedPeople.length > 0 && (
            <ul className="list-disc pl-5 text-[var(--muted)]">
              {outcome.report.unmatchedPeople.map((p) => (
                <li key={p.personId}>{p.name} (no Slack match)</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {outcome?.kind === "not_configured" && (
        <p className="text-sm text-[var(--muted)]">Slack bot token not set — sync is unavailable.</p>
      )}
      {outcome?.kind === "error" && (
        <p className="text-sm text-[var(--red)]">Sync failed: {outcome.message}</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ChannelResult = {
  channelId: string;
  label: string | null;
  invited: number;
  alreadyIn: number;
  skippedNoSlack: number;
  failed: number;
  membersReadFailed?: boolean;
  error?: string;
};

type SlackSummary = {
  effectiveActive: number;
  withSlackCount: number;
  withoutSlackCount: number;
  slackConfigured: boolean;
  channels: ChannelResult[];
};

type ReconcileOutcome =
  | { status: "ok"; scope: number; added: number; errors: number }
  | { status: "not_configured" }
  | { status: "error"; message: string };

type BackfillResponse = {
  ok: true;
  slack: SlackSummary;
  drive: ReconcileOutcome;
  github: ReconcileOutcome;
};

export function InviteAllMembersButton({
  teamId,
  effectiveActive,
  withSlackCount,
  withoutSlackCount,
  channelCount,
}: {
  teamId: string;
  effectiveActive: number;
  withSlackCount: number;
  withoutSlackCount: number;
  channelCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackfillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    const lines = [
      `Invite this team's effective members everywhere at once?`,
      ``,
      `• ${withSlackCount} effective member${withSlackCount === 1 ? "" : "s"} with a linked Slack account will be invited to ${channelCount} linked channel${channelCount === 1 ? "" : "s"}.`,
    ];
    if (withoutSlackCount > 0) {
      lines.push(`• ${withoutSlackCount} effective member${withoutSlackCount === 1 ? "" : "s"} have no Slack link and will be skipped.`);
    }
    lines.push(`• Google Drive groups and GitHub teams will be reconciled now.`);
    if (!confirm(lines.join("\n"))) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/backfill`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as BackfillResponse | { error?: string } | null;
      if (res.ok && body && "ok" in body && body.ok === true) {
        setResult(body);
        router.refresh();
      } else {
        setError((body && "error" in body && body.error) || `Request failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <button onClick={run} className="btn btn-primary self-start" disabled={busy}>
          {busy ? "Inviting…" : "Invite all effective members"}
        </button>
        <p className="text-sm text-[var(--muted)]">
          {effectiveActive} effective member{effectiveActive === 1 ? "" : "s"} ({withSlackCount} with Slack
          {withoutSlackCount > 0 ? `, ${withoutSlackCount} without` : ""}) · {channelCount} linked channel
          {channelCount === 1 ? "" : "s"}. Also reconciles Drive &amp; GitHub now.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--red)]" role="alert">Failed: {error}</p>}

      {result && <BackfillReport result={result} />}
    </div>
  );
}

function BackfillReport({ result }: { result: BackfillResponse }) {
  const { slack, drive, github } = result;
  return (
    <div className="flex flex-col gap-3" role="status">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold">Slack</div>
        {!slack.slackConfigured ? (
          <p className="text-sm text-[var(--muted)]">Slack isn&apos;t configured in this environment — no invites sent.</p>
        ) : slack.channels.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No linked Slack channels.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {slack.channels.map((c) => (
              <li key={c.channelId} className="text-sm">
                <span className="mono">{c.label ? `#${c.label.replace(/^#/, "")}` : c.channelId}</span>{" "}
                {c.membersReadFailed
                  ? `— invited up to ${c.invited} (couldn't read current membership, already-in unknown)`
                  : `— invited ${c.invited}, already in ${c.alreadyIn}`}
                {c.skippedNoSlack > 0 ? `, skipped ${c.skippedNoSlack} (no Slack)` : ""}
                {c.failed > 0 ? (
                  <span className="text-[var(--red)]">, failed {c.failed}{c.error ? ` (${c.error})` : ""}</span>
                ) : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-sm">
        <span className="font-semibold">Drive:</span> {reconcileLine(drive, "group")}
      </div>
      <div className="text-sm">
        <span className="font-semibold">GitHub:</span> {reconcileLine(github, "team")}
      </div>
    </div>
  );
}

function reconcileLine(outcome: ReconcileOutcome, noun: string): string {
  if (outcome.status === "not_configured") return "not configured in this environment.";
  if (outcome.status === "error") return `reconcile failed (${outcome.message}).`;
  const scope = `${outcome.scope} ${noun}${outcome.scope === 1 ? "" : "s"}`;
  const errs = outcome.errors > 0 ? `, ${outcome.errors} error${outcome.errors === 1 ? "" : "s"}` : "";
  return `reconciled ${scope} — ${outcome.added} added${errs}.`;
}

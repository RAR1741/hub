"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { Provider, TeamExternalAccountRow } from "@/lib/team-external-accounts";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Invalid identifier.",
  github_user_not_found: "No GitHub user with that login.",
};

export function ExternalAccountManager({
  teamId,
  rows,
  isLinkedGoogle,
  isLinkedGithub,
}: {
  teamId: string;
  rows: TeamExternalAccountRow[];
  isLinkedGoogle: boolean;
  isLinkedGithub: boolean;
}) {
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<Provider>("google");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/external-accounts`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        if (method === "POST") {
          setLabel("");
          setIdentifier("");
        }
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(res.status === 409 ? "Already added." : ERROR_MESSAGES[data?.error ?? ""] ?? "Failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">External accounts ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No external accounts yet — add one below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--hair)]">
          {rows.map((r) => (
            <li
              key={`${r.provider}:${r.identifier}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span>
                {r.label}{" "}
                <span className="pill">{r.provider}</span>{" "}
                {r.provider === "github" ? `@${r.identifier}` : r.identifier}
              </span>
              <Button
                variant="danger"
                className="px-3 py-1"
                disabled={busy}
                onClick={() => call("DELETE", { provider: r.provider, identifier: r.identifier })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="label">
          Label{" "}
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Programming bot"
          />
        </label>
        <label className="label">
          Provider{" "}
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="google">google</option>
            <option value="github">github</option>
          </select>
        </label>
        <label className="label">
          Identifier{" "}
          <input
            className="input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={provider === "google" ? "bot@example.com" : "some-login"}
          />
        </label>
        <Button
          variant="primary"
          disabled={!label || !identifier}
          onClick={() => call("POST", { provider, identifier, label })}
          pending={busy}
          pendingLabel="Working…"
        >
          Add
        </Button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        {isLinkedGoogle || isLinkedGithub
          ? "These accounts are added to the linked Google Group / GitHub Team but never get hub access."
          : "These accounts take effect once the team is linked to a Google Group or GitHub Team."}
      </p>
      {error && <p role="status" className="text-sm text-[var(--muted)]">{error}</p>}
    </section>
  );
}

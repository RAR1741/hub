"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PersonSlackLink({
  personId,
  slackUserId,
}: {
  personId: string;
  slackUserId: string | null;
}) {
  const [value, setValue] = useState(slackUserId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function call(init: RequestInit) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/people/${personId}/slack`, init);
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        body?.error === "slack_id_taken"
          ? "That Slack account is already linked to someone else."
          : "Couldn't save that. Please try again.",
      );
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">
        {slackUserId ? (
          <>
            Linked to Slack user <span className="mono">{slackUserId}</span>.
          </>
        ) : (
          "Not linked."
        )}
      </p>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          call({
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slackUserId: value }),
          });
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="U0123ABCDEF"
          aria-label="Slack user id"
        />
        <button type="submit" className="btn" disabled={busy || !value.trim()}>
          Save
        </button>
        {slackUserId && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => call({ method: "DELETE" })}
          >
            Unlink
          </button>
        )}
      </form>
    </div>
  );
}

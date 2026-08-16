"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CandidatePair, PersonCard } from "@/lib/merge-people";

function fullName(p: PersonCard): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/**
 * Default winner pick: more sessions wins; tie -> the one with any email/identity;
 * still tie -> lexicographically-smaller id.
 */
function defaultWinnerId(a: PersonCard, b: PersonCard): string {
  if (a.sessionCount !== b.sessionCount) {
    return a.sessionCount > b.sessionCount ? a.id : b.id;
  }
  if (a.emails.length !== b.emails.length) {
    return a.emails.length > 0 ? a.id : b.id;
  }
  return a.id < b.id ? a.id : b.id;
}

export function DuplicatePeople({ pairs }: { pairs: CandidatePair[] }) {
  if (pairs.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No likely duplicates found.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {pairs.map((pair) => (
        <DuplicatePair key={`${pair.a.id}-${pair.b.id}`} pair={pair} />
      ))}
    </div>
  );
}

function DuplicatePair({ pair }: { pair: CandidatePair }) {
  const { a, b } = pair;
  const [winnerId, setWinnerId] = useState(() => defaultWinnerId(a, b));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const winner = winnerId === a.id ? a : b;
  const loser = winnerId === a.id ? b : a;

  async function confirmMerge() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/people/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId: winner.id, loserId: loser.id }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't merge those people. Please try again.");
    } catch {
      setError("Couldn't merge those people. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <div className="border-t border-[var(--hair)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <PersonCardView
          person={a}
          isWinner={winnerId === a.id}
          disabled={busy}
          onChoose={() => setWinnerId(a.id)}
        />
        <PersonCardView
          person={b}
          isWinner={winnerId === b.id}
          disabled={busy}
          onChoose={() => setWinnerId(b.id)}
        />
      </div>

      {error && <p className="mt-2 text-sm text-[var(--red)]">{error}</p>}

      {confirming ? (
        <div className="mt-3 flex flex-col gap-2 rounded border border-[var(--hair)] p-3">
          <p className="text-sm">
            Merge <span className="font-medium">{fullName(loser)}</span> into{" "}
            <span className="font-medium">{fullName(winner)}</span>. This reassigns{" "}
            {fullName(loser)}&rsquo;s sessions, teams, emails, and history to{" "}
            {fullName(winner)}, then deletes {fullName(loser)}. This can&rsquo;t be
            undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={confirmMerge}
            >
              {busy ? "Merging…" : "Confirm merge"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Merge
          </button>
        </div>
      )}
    </div>
  );
}

function PersonCardView({
  person,
  isWinner,
  disabled,
  onChoose,
}: {
  person: PersonCard;
  isWinner: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const name = fullName(person);
  return (
    <label
      className={`card flex flex-1 flex-col gap-2 ${isWinner ? "border-[var(--red)]" : ""}`}
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          name={`winner-${person.id}`}
          checked={isWinner}
          disabled={disabled}
          onChange={onChoose}
          aria-label={`Keep ${name}`}
        />
        <span className="font-medium">{name}</span>
        <span className="pill">{person.role}</span>
        {!person.isActive && <span className="pill off">Inactive</span>}
      </div>
      <div className="text-sm text-[var(--muted)]">
        {person.sessionCount} session{person.sessionCount === 1 ? "" : "s"}
      </div>
      <div className="text-sm">
        {person.emails.length === 0 ? (
          <span className="text-[var(--muted)]">No sign-in emails</span>
        ) : (
          person.emails.map((email, i) => (
            <span key={email} className="mono">
              {i > 0 && ", "}
              {email}
            </span>
          ))
        )}
      </div>
      <div className="text-sm text-[var(--muted)]">
        {person.teams.length === 0 ? "No teams" : person.teams.join(", ")}
      </div>
    </label>
  );
}

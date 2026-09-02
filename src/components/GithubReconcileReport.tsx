"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GithubReconcileResult } from "@/lib/github-team-sync";
import type { GithubUser } from "@/lib/github-teams";

type PickPerson = { id: string; name: string };

/**
 * Renders the last GitHub team reconcile report. Logins resolve to hub names
 * via `nameByLogin`; a login with no match in "Added"/"Pending" renders as a
 * plain `@login` link to the GitHub profile. "Would remove" entries with no
 * match instead open a picker to hand-link that GitHub account to a hub
 * person — a manual, admin-only alternative to the OAuth "Connect GitHub"
 * flow (the reconcile diff keys on numeric github_user_id, so a manual link
 * is functionally identical to an OAuth one).
 */
export function GithubReconcileReport({
  report,
  nameByLogin,
  people,
}: {
  report: GithubReconcileResult;
  nameByLogin: Record<string, string>;
  people: PickPerson[];
}) {
  // The GitHub user currently being assigned (modal open when non-null).
  const [assocUser, setAssocUser] = useState<GithubUser | null>(null);

  const nameFor = (login: string): string | null => nameByLogin[login.toLowerCase()] ?? null;

  return (
    <>
      <p className="text-sm text-[var(--muted)]">
        Ran at <span className="mono">{new Date(report.ranAt).toLocaleString()}</span>
      </p>
      <div className="flex flex-col gap-4">
        {report.teams.map((t) => (
          <div
            key={t.teamSlug}
            className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {t.teamName} <span className="text-[var(--muted)]">({t.teamSlug})</span>
              </span>
              <span className="text-xs text-[var(--muted)]">
                {t.actualCount} actual / {t.expectedCount} expected
              </span>
            </div>
            <LoginList label="Added" logins={t.added} nameFor={nameFor} />
            <LoginList label="Pending" logins={t.pending} nameFor={nameFor} />
            <WouldRemoveList users={t.wouldRemove} nameFor={nameFor} onPick={setAssocUser} />
            {t.notConnected.length > 0 && (
              <div className="text-sm">
                <span className="font-medium">Not connected: </span>
                {t.notConnected.join(", ")}
              </div>
            )}
            {t.errors.length > 0 && (
              <div className="text-sm text-[var(--red)]">
                <span className="font-medium">Errors: </span>
                {t.errors.join("; ")}
              </div>
            )}
          </div>
        ))}
      </div>

      {assocUser !== null && (
        <AssignModal user={assocUser} people={people} onClose={() => setAssocUser(null)} />
      )}
    </>
  );
}

function LoginList({
  label,
  logins,
  nameFor,
}: {
  label: string;
  logins: string[];
  nameFor: (login: string) => string | null;
}) {
  if (logins.length === 0) return null;
  return (
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      {logins.map((login, i) => {
        const name = nameFor(login);
        return (
          <span key={login}>
            {i > 0 && ", "}
            {name ? (
              <span>{name}</span>
            ) : (
              <a
                href={`https://github.com/${login}`}
                target="_blank"
                rel="noreferrer"
                className="link-btn"
              >
                @{login}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}

function WouldRemoveList({
  users,
  nameFor,
  onPick,
}: {
  users: GithubUser[];
  nameFor: (login: string) => string | null;
  onPick: (user: GithubUser) => void;
}) {
  if (users.length === 0) return null;
  return (
    <div className="text-sm">
      <span className="font-medium">Would remove: </span>
      {users.map((u, i) => {
        const name = nameFor(u.login);
        return (
          <span key={u.login}>
            {i > 0 && ", "}
            {name ? (
              <span>{name}</span>
            ) : (
              <button
                type="button"
                className="link-btn"
                onClick={() => onPick(u)}
                title="Assign this GitHub account to a person"
              >
                @{u.login}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function AssignModal({
  user,
  people,
  onClose,
}: {
  user: GithubUser;
  people: PickPerson[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, query]);

  async function confirmAssign() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${picked.id}/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUserId: user.id, githubLogin: user.login }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      const resBody = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        resBody?.error === "taken"
          ? "That GitHub account is already linked to another person."
          : "Couldn't save that. Please try again.",
      );
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Assign GitHub account to a person"
      onClick={onClose}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {picked ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Confirm assignment</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Assign <span className="mono">@{user.login}</span> to{" "}
                  <span className="font-medium">{picked.name}</span>? This links the account
                  without OAuth verification and will govern their GitHub team membership.
                </p>
              </div>
              <button type="button" className="btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            {error && <p className="mt-2 text-sm text-[var(--red)]">{error}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => setPicked(null)}>
                Back
              </button>
              <button type="button" className="btn" disabled={busy} onClick={confirmAssign}>
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Assign GitHub account</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Link <span className="mono">@{user.login}</span> to a person.
                </p>
              </div>
              <button type="button" className="btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            <label className="search mt-3">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
              />
            </label>

            <div className="modal-list mt-3">
              {filtered.length === 0 ? (
                <p className="p-3 text-sm text-[var(--muted)]">No people match.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="modal-row"
                    onClick={() => setPicked(p)}
                  >
                    <span>{p.name}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

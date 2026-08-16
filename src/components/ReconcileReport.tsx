"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReconcileResult } from "@/lib/drive-group-sync";

type PickPerson = { id: string; name: string };

/**
 * Renders the last reconcile report. Emails that resolve to a person show the
 * person's name; emails with no person record are rendered as buttons that open
 * a picker to associate that email with an existing person.
 */
export function ReconcileReport({
  report,
  nameByEmail,
  people,
}: {
  report: ReconcileResult;
  nameByEmail: Record<string, string>;
  people: PickPerson[];
}) {
  // The email currently being associated (modal open when non-null).
  const [assocEmail, setAssocEmail] = useState<string | null>(null);

  const nameFor = (email: string): string | null => nameByEmail[email.toLowerCase()] ?? null;

  return (
    <>
      <p className="text-sm text-[var(--muted)]">
        Ran at <span className="mono">{new Date(report.ranAt).toLocaleString()}</span>
      </p>
      <div className="flex flex-col gap-4">
        {report.groups.map((g) => (
          <div
            key={g.groupEmail}
            className="flex flex-col gap-2 border-t border-[var(--hair)] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{g.teamName}</span>
              <span className="text-xs text-[var(--muted)]">
                {g.actualCount} actual / {g.expectedCount} expected
              </span>
            </div>
            <EmailList label="Added" emails={g.added} nameFor={nameFor} onPick={setAssocEmail} />
            <EmailList label="Would remove" emails={g.wouldRemove} nameFor={nameFor} onPick={setAssocEmail} />
            {g.errors.length > 0 && (
              <div className="text-sm text-[var(--red)]">
                <span className="font-medium">Errors: </span>
                {g.errors.join("; ")}
              </div>
            )}
          </div>
        ))}
      </div>

      {assocEmail !== null && (
        <AssociateModal
          email={assocEmail}
          people={people}
          onClose={() => setAssocEmail(null)}
        />
      )}
    </>
  );
}

function EmailList({
  label,
  emails,
  nameFor,
  onPick,
}: {
  label: string;
  emails: string[];
  nameFor: (email: string) => string | null;
  onPick: (email: string) => void;
}) {
  return (
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      {emails.length === 0 ? (
        <span className="text-[var(--muted)]">none</span>
      ) : (
        emails.map((email, i) => {
          const name = nameFor(email);
          return (
            <span key={email}>
              {i > 0 && ", "}
              {name ? (
                <span>{name}</span>
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onPick(email)}
                  title="Associate this email with a person"
                >
                  {email}
                </button>
              )}
            </span>
          );
        })
      )}
    </div>
  );
}

function AssociateModal({
  email,
  people,
  onClose,
}: {
  email: string;
  people: PickPerson[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
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

  async function associate(personId: string) {
    if (busyId) return;
    setBusyId(personId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/people/${personId}/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        body?.error === "email_taken"
          ? "That email is already assigned to someone else."
          : "Couldn't save that. Please try again.",
      );
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Associate email with a person"
      onClick={onClose}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Associate email</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Save <span className="mono">{email}</span> to a person.
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

        {error && <p className="mt-2 text-sm text-[var(--red)]">{error}</p>}

        <div className="modal-list mt-3">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-[var(--muted)]">No people match.</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className="modal-row"
                disabled={busyId !== null}
                onClick={() => associate(p.id)}
              >
                <span>{p.name}</span>
                {busyId === p.id && <span className="text-xs text-[var(--muted)]">saving…</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

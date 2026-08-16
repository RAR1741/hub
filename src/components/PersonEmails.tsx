"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IdentityView = { id: string; email: string; isPrimary: boolean; linked: boolean };

export function PersonEmails({
  personId,
  identities,
}: {
  personId: string;
  identities: IdentityView[];
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function call(input: RequestInfo, init?: RequestInit) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      if (res.ok) {
        setEmail("");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        body?.error === "email_taken"
          ? "That email already belongs to someone else."
          : body?.error === "primary_with_secondaries"
            ? "Make another email primary before removing this one."
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
      {identities.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No sign-in emails yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {identities.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="mono">{i.email}</span>
              {i.isPrimary && <span className="pill">Primary</span>}
              {i.linked && <span className="pill">Google linked</span>}
              {!i.isPrimary && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    call(`/api/admin/people/${personId}/emails/${i.id}/primary`, {
                      method: "POST",
                    })
                  }
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  const warning = i.linked
                    ? `Remove ${i.email}? This unlinks its Google sign-in.`
                    : `Remove ${i.email}?`;
                  if (!window.confirm(warning)) return;
                  call(`/api/admin/people/${personId}/emails/${i.id}`, {
                    method: "DELETE",
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          call(`/api/admin/people/${personId}/emails`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="add.email@example.com"
          aria-label="Add sign-in email"
        />
        <button type="submit" className="btn" disabled={busy || !email.trim()}>
          Add email
        </button>
      </form>
    </div>
  );
}

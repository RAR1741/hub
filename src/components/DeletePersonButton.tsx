"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export function DeletePersonButton({
  personId,
  name,
  labeled,
}: {
  personId: string;
  name: string;
  /** Show a labeled danger button (edit page) instead of the icon-only row action. */
  labeled?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm(`Delete ${name}? This removes their sessions and team memberships too.`)) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/people/${personId}`, { method: "DELETE" });
      if (res.ok) {
        if (labeled) router.push("/admin/people");
        router.refresh();
      } else if (res.status === 409) {
        setStatus("Can't delete — this person edited/reviewed records still on file.");
      } else {
        setStatus("Delete failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (labeled) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={remove} className="btn btn-danger" disabled={busy}>
          <Icon name="trash" /> {busy ? "Deleting…" : "Delete person"}
        </button>
        {status && <span role="status" className="text-sm text-[var(--muted)]">{status}</span>}
      </span>
    );
  }

  return (
    <>
      <button onClick={remove} className="btn icon danger" aria-label={`Delete ${name}`} disabled={busy}>
        <Icon name="trash" />
      </button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </>
  );
}

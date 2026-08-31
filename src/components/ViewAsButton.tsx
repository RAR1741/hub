"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function ViewAsButton({
  personId,
  name,
  labeled,
}: {
  personId: string;
  name: string;
  /** Show a labeled button (edit page) instead of the icon-only row action. */
  labeled?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function viewAs() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/masquerade/${personId}`, {
        method: "POST",
      });
      if (res.ok) {
        if (labeled) {
          router.push("/admin/people");
        } else {
          router.refresh();
        }
      } else if (res.status === 404) {
        setStatus("Person not found.");
      } else if (res.status === 409) {
        setStatus("Can't view as — person is inactive or is an admin.");
      } else {
        setStatus("Failed to start masquerade.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (labeled) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={viewAs} className="btn btn-secondary" disabled={busy}>
          <Icon name="eye" /> {busy ? "Starting…" : "View as"}
        </button>
        {status && <span role="status" className="text-sm text-[var(--muted)]">{status}</span>}
      </span>
    );
  }

  return (
    <>
      <button onClick={viewAs} className="btn icon" aria-label={`View as ${name}`} disabled={busy}>
        <Icon name="eye" />
      </button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </>
  );
}

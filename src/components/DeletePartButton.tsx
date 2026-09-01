"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Redirects to the parent assembly on success, or the project if top-level. */
export function DeletePartButton({
  partId,
  projectId,
  parentPartId,
}: {
  partId: string;
  projectId: string;
  parentPartId: string | null;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this part? Only possible when it has no children.")) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/parts/${partId}`, { method: "DELETE" });
      if (res.ok) {
        router.push(parentPartId ? `/admin/parts/${parentPartId}` : `/admin/projects/${projectId}`);
        router.refresh();
      } else if (res.status === 409) {
        setStatus("Can't delete an assembly with existing children — remove them first.");
      } else {
        setStatus("Delete failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <p>
      <button onClick={remove} className="btn btn-danger" disabled={busy}>{busy ? "Deleting…" : "Delete part"}</button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </p>
  );
}

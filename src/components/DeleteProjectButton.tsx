"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this project? Only possible when it has no parts.")) return;
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin/projects");
        router.refresh();
      } else if (res.status === 409) {
        setStatus("Project still has parts — remove them first.");
      } else {
        setStatus("Delete failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <p>
      <button onClick={remove} className="btn btn-danger" disabled={busy}>{busy ? "Deleting…" : "Delete project"}</button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </p>
  );
}

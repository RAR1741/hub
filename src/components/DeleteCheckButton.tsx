"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCheckButton({ checkId }: { checkId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this check entry?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tool-checks/${checkId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={remove} className="btn btn-danger px-3 py-1" disabled={busy}>{busy ? "Deleting…" : "Delete"}</button>
  );
}

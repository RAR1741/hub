"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteToolButton({ toolId }: { toolId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this tool and its check history?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tools/${toolId}`, { method: "DELETE" });
      if (res.ok) router.push("/tools");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={remove} className="btn btn-danger" disabled={busy}>{busy ? "Deleting…" : "Delete tool"}</button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export function DeletePeriodButton({ periodId, name }: { periodId: string; name: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function remove() {
    if (!confirm(`Delete the period "${name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/periods/${periodId}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else if (res.status === 409) {
      setStatus("Can't delete — this period has sessions on file.");
    } else {
      setStatus("Delete failed.");
    }
  }

  return (
    <>
      <button onClick={remove} className="btn icon danger" aria-label={`Delete ${name}`}>
        <Icon name="trash" />
      </button>
      {status && <span role="status" className="text-sm text-[var(--muted)]"> {status}</span>}
    </>
  );
}

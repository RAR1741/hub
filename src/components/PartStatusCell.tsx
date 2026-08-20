"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PART_STATUSES, STATUS_MAP, STATUS_TONE } from "@/lib/types";
import type { PartStatus } from "@/lib/types";

/** Inline status badge/select — PATCHes {status} on change (replaces cheesy's jQuery editPart AJAX). */
export function PartStatusCell({ partId, status }: { partId: string; status: PartStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/parts/${partId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Status"
      className={`status-${STATUS_TONE[status]}`}
      value={status}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
    >
      {PART_STATUSES.map((s) => (
        <option key={s} value={s}>{STATUS_MAP[s]}</option>
      ))}
    </select>
  );
}

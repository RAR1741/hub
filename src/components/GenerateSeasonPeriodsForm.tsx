"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateSeasonPeriodsForm({ currentYear }: { currentYear: number }) {
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/periods/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      if (res.ok) {
        const { created, skipped } = await res.json();
        setStatus(
          `Created ${created.length}${skipped.length ? `, skipped ${skipped.length} (already existed)` : ""}.`,
        );
        router.refresh();
      } else {
        setStatus("Generate failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">
        Season
        <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{`${y}-${y + 1}`}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Generating…" : "Generate periods"}
      </button>
      {status && <p role="status" className="text-sm text-[var(--color-muted-fg)]">{status}</p>}
    </form>
  );
}

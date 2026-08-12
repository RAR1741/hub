"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BuildDayForm() {
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"required" | "optional">("required");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/build-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, kind }),
      });
      if (res.ok) {
        setStatus("Saved.");
        setDate("");
        router.refresh();
      } else {
        setStatus("Save failed — check the date.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="label">
        Date <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="label">
        Kind{" "}
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as "required" | "optional")}
        >
          <option value="required">required</option>
          <option value="optional">optional</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add build day"}
      </button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

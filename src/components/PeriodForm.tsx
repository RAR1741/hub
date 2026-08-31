"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PeriodFormValues = { name: string; startsOn: string; endsOn: string };

export function PeriodForm({
  initial,
  periodId,
}: {
  initial?: PeriodFormValues;
  periodId?: string;
}) {
  const [values, setValues] = useState<PeriodFormValues>(
    initial ?? { name: "", startsOn: "", endsOn: "" },
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(periodId ? `/api/admin/periods/${periodId}` : "/api/admin/periods", {
        method: periodId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        setStatus("Saved.");
        router.refresh();
        if (!periodId) setValues({ name: "", startsOn: "", endsOn: "" });
      } else if (res.status === 409) {
        setStatus("A period with that name already exists.");
      } else {
        setStatus("Save failed — check the fields (end date must be on/after start).");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name <input className="input" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label className="label">Starts <input className="input" type="date" value={values.startsOn} onChange={(e) => setValues({ ...values, startsOn: e.target.value })} required /></label>
      <label className="label">Ends <input className="input" type="date" value={values.endsOn} onChange={(e) => setValues({ ...values, endsOn: e.target.value })} required /></label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : periodId ? "Save changes" : "Create period"}</button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

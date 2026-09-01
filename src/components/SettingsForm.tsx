"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SettingsValues = {
  gcalCalendarId: string;
  autoCloseEnabled: boolean;
  autoCloseHours: number;
  maxShiftHours: number;
  seasonHoursGoal: number;
};

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [values, setValues] = useState<SettingsValues>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) { setStatus("Saved."); router.refresh(); }
      else if (res.status === 400) setStatus("Check the fields (hours in range).");
      else setStatus("Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Google Calendar id{" "}
        <input className="input" value={values.gcalCalendarId}
          onChange={(e) => setValues({ ...values, gcalCalendarId: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted)]">
        <input type="checkbox" checked={values.autoCloseEnabled}
          onChange={(e) => setValues({ ...values, autoCloseEnabled: e.target.checked })} />
        Auto-close stale open sessions overnight
      </label>
      <label className={`label${values.autoCloseEnabled ? "" : " opacity-50"}`}>Auto-close hours{" "}
        <input className="input" type="number" min={1} max={24} value={values.autoCloseHours}
          disabled={!values.autoCloseEnabled}
          onChange={(e) => setValues({ ...values, autoCloseHours: Number(e.target.value) })}
          required={values.autoCloseEnabled} />
      </label>
      <label className="label">Max shift hours{" "}
        <input className="input" type="number" min={1} max={48} value={values.maxShiftHours}
          onChange={(e) => setValues({ ...values, maxShiftHours: Number(e.target.value) })} required />
      </label>
      <label className="label">Season hours goal (0 = no goal){" "}
        <input className="input" type="number" min={0} max={100000} value={values.seasonHoursGoal}
          onChange={(e) => setValues({ ...values, seasonHoursGoal: Number(e.target.value) })} required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

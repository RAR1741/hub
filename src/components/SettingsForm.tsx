"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SettingsValues = {
  teamTimezone: string;
  gcalCalendarId: string;
  autoCloseHours: number;
  maxShiftHours: number;
};

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [values, setValues] = useState<SettingsValues>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) { setStatus("Saved."); router.refresh(); }
    else if (res.status === 400) setStatus("Check the fields (timezone must be a valid IANA zone; hours in range).");
    else setStatus("Save failed.");
  }

  return (
    <form onSubmit={submit}>
      <label>Team timezone{" "}
        <input value={values.teamTimezone}
          onChange={(e) => setValues({ ...values, teamTimezone: e.target.value })} required />
      </label>
      <label>Google Calendar id{" "}
        <input value={values.gcalCalendarId}
          onChange={(e) => setValues({ ...values, gcalCalendarId: e.target.value })} />
      </label>
      <label>Auto-close hours{" "}
        <input type="number" min={1} max={24} value={values.autoCloseHours}
          onChange={(e) => setValues({ ...values, autoCloseHours: Number(e.target.value) })} required />
      </label>
      <label>Max shift hours{" "}
        <input type="number" min={1} max={48} value={values.maxShiftHours}
          onChange={(e) => setValues({ ...values, maxShiftHours: Number(e.target.value) })} required />
      </label>
      <button type="submit">Save settings</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}

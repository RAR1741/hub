"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { datetimeLocalToInstant } from "@/lib/tz";

export type MeetingFormValues = { title: string; startsAt: string; endsAt: string };

const EMPTY: MeetingFormValues = { title: "", startsAt: "", endsAt: "" };

export function MeetingForm({ teamTz }: { teamTz: string }) {
  const [values, setValues] = useState<MeetingFormValues>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          startsAt: values.startsAt ? datetimeLocalToInstant(values.startsAt, teamTz) : "",
          endsAt: values.endsAt ? datetimeLocalToInstant(values.endsAt, teamTz) : "",
        }),
      });
      if (res.ok) {
        setStatus("Saved.");
        setValues(EMPTY);
        router.refresh();
      } else {
        setStatus("Save failed — check the fields (end must be on/after start).");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="label">
        Title{" "}
        <input
          className="input"
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
          required
        />
      </label>
      <label className="label">
        Starts{" "}
        <input
          className="input"
          type="datetime-local"
          value={values.startsAt}
          onChange={(e) => setValues({ ...values, startsAt: e.target.value })}
          required
        />
      </label>
      <label className="label">
        Ends{" "}
        <input
          className="input"
          type="datetime-local"
          value={values.endsAt}
          onChange={(e) => setValues({ ...values, endsAt: e.target.value })}
          required
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add meeting"}
      </button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

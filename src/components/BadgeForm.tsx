"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type BadgeFormValues = {
  name: string;
  category: string;
  description: string;
  color: string;
  teamId: string;
  allowSelfAward: boolean;
};

export function BadgeForm({
  teams,
  initial,
  badgeId,
}: {
  teams: { id: string; name: string }[];
  initial?: BadgeFormValues;
  badgeId?: string; // present = edit
}) {
  const EMPTY: BadgeFormValues = {
    name: "", category: "", description: "", color: "#6b7280", teamId: "", allowSelfAward: false,
  };
  const [values, setValues] = useState<BadgeFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(badgeId ? `/api/admin/badges/${badgeId}` : "/api/admin/badges", {
        method: badgeId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          category: values.category || undefined,
          description: values.description || undefined,
          color: values.color,
          teamId: values.teamId || undefined,
          allowSelfAward: values.allowSelfAward,
        }),
      });
      if (res.ok) {
        setStatus("Saved.");
        router.refresh();
        if (!badgeId) setValues(EMPTY);
      } else if (res.status === 409) {
        setStatus("A badge with that name already exists.");
      } else {
        setStatus("Save failed — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name <input className="input" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label className="label">Category <input className="input" value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} /></label>
      <label className="label">Description <input className="input" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
      <label className="label">Color{" "}
        <input
          className="input"
          type="color"
          value={values.color}
          onChange={(e) => setValues({ ...values, color: e.target.value })}
        />
      </label>
      <label className="label">Team{" "}
        <select className="input" value={values.teamId} onChange={(e) => setValues({ ...values, teamId: e.target.value })}>
          <option value="">(none — all teams)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted)]">
        <input type="checkbox" checked={values.allowSelfAward} onChange={(e) => setValues({ ...values, allowSelfAward: e.target.checked })} />
        Allow self-award
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : badgeId ? "Save changes" : "Create badge"}</button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

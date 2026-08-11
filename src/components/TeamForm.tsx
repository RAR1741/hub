"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TeamFormValues = {
  name: string;
  parentTeamId: string;
  description: string;
  joinMode: string;
};

export function TeamForm({
  teams,
  initial,
  teamId,
}: {
  teams: { id: string; name: string }[]; // parent options
  initial?: TeamFormValues;
  teamId?: string; // present = edit
}) {
  const EMPTY: TeamFormValues = { name: "", parentTeamId: "", description: "", joinMode: "admin_only" };
  const [values, setValues] = useState<TeamFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(teamId ? `/api/admin/teams/${teamId}` : "/api/admin/teams", {
      method: teamId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        parentTeamId: values.parentTeamId || undefined,
        description: values.description || undefined,
        joinMode: values.joinMode,
      }),
    });
    if (res.ok) {
      setStatus("Saved.");
      router.refresh();
      if (!teamId) setValues(EMPTY);
    } else if (res.status === 409) {
      setStatus("A team with that name already exists.");
    } else {
      setStatus("Save failed — check the fields.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name <input className="input" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label className="label">Parent{" "}
        <select className="input" value={values.parentTeamId} onChange={(e) => setValues({ ...values, parentTeamId: e.target.value })}>
          <option value="">(none — top level)</option>
          {teams.filter((t) => t.id !== teamId).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="label">Description <input className="input" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
      <label className="label">Join mode{" "}
        <select className="input" value={values.joinMode} onChange={(e) => setValues({ ...values, joinMode: e.target.value })}>
          <option value="admin_only">admin only</option>
          <option value="open">open</option>
          <option value="requires_approval">requires approval</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary">{teamId ? "Save changes" : "Create team"}</button>
      {status && <p role="status" className="text-sm text-[var(--color-muted-fg)]">{status}</p>}
    </form>
  );
}

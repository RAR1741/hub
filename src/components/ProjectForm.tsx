"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";

export function ProjectForm({ project, onSaved }: { project?: Project; onSaved?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [partNumberPrefix, setPartNumberPrefix] = useState(project?.partNumberPrefix ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(project ? `/api/admin/projects/${project.id}` : "/api/admin/projects", {
        method: project ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, partNumberPrefix }),
      });
      if (res.ok) {
        if (!project) {
          setName("");
          setPartNumberPrefix("");
        }
        router.refresh();
        onSaved?.();
      } else if (res.status === 409) {
        setError("A project with that name or prefix already exists.");
      } else {
        setError(project ? "Could not save changes." : "Could not create the project — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="label">Part number prefix
        <input className="input" value={partNumberPrefix} onChange={(e) => setPartNumberPrefix(e.target.value)} required maxLength={20} />
        <span className="text-sm text-[var(--color-muted-fg)]">Letters/numbers only, e.g. RA2026 → RA2026-A-100.</span>
      </label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : project ? "Save changes" : "Create project"}
      </button>
    </form>
  );
}

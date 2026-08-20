"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Part } from "@/lib/types";

/**
 * Create a part. Creation sets nothing but name/type/parent — details are
 * added via edit, like cheesy. Parts must belong to an assembly (numbering
 * collides otherwise, see parts.ts); assemblies stay optionally top-level.
 */
export function PartForm({ projectId, assemblies }: { projectId: string; assemblies: Part[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"part" | "assembly">(assemblies.length > 0 ? "part" : "assembly");
  const [parentPartId, setParentPartId] = useState(assemblies[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noAssembliesYet = assemblies.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, type, name, parentPartId: parentPartId || undefined }),
      });
      if (res.ok) {
        setName("");
        setType(assemblies.length > 0 ? "part" : "assembly");
        setParentPartId(assemblies[0]?.id ?? "");
        router.refresh();
      } else {
        setError("Could not create the part — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="label">Type
        <select className="input" value={type} onChange={(e) => setType(e.target.value as "part" | "assembly")}>
          <option value="part" disabled={noAssembliesYet}>Part{noAssembliesYet ? " (create an assembly first)" : ""}</option>
          <option value="assembly">Assembly</option>
        </select>
      </label>
      {type === "part" ? (
        <label className="label">Parent assembly
          <select className="input" value={parentPartId} onChange={(e) => setParentPartId(e.target.value)} required>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      ) : (
        <label className="label">Parent assembly (optional)
          <select className="input" value={parentPartId} onChange={(e) => setParentPartId(e.target.value)}>
            <option value="">— Top level —</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Creating…" : "Create part"}
      </button>
    </form>
  );
}

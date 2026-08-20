"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PART_STATUSES, PRIORITY_MAP, STATUS_MAP } from "@/lib/types";
import type { Part, PartPriority, PartStatus } from "@/lib/types";

const PRIORITIES = [0, 1, 2] as const satisfies readonly PartPriority[];

/**
 * Full edit form for a part's detail-page fields. Assemblies have no
 * material/quantity/cut-length fields in cheesy-parts, so those are only
 * shown for `type === "part"`. PATCHes only the fields this form owns.
 */
export function PartEditForm({ part, onSaved }: { part: Part; onSaved?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(part.name);
  const [status, setStatus] = useState<PartStatus>(part.status);
  const [priority, setPriority] = useState<PartPriority>(part.priority);
  const [notes, setNotes] = useState(part.notes ?? "");
  const [sourceMaterial, setSourceMaterial] = useState(part.sourceMaterial ?? "");
  const [quantity, setQuantity] = useState(part.quantity ?? "");
  const [cutLength, setCutLength] = useState(part.cutLength ?? "");
  const [haveMaterial, setHaveMaterial] = useState(part.haveMaterial);
  const [drawingCreated, setDrawingCreated] = useState(part.drawingCreated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, status, priority, notes };
      if (part.type === "part") {
        Object.assign(body, {
          sourceMaterial,
          quantity,
          cutLength,
          haveMaterial,
          drawingCreated,
        });
      }
      const res = await fetch(`/api/admin/parts/${part.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        onSaved?.();
      } else {
        setError("Could not save changes.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="label">Status
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PartStatus)}>
          {PART_STATUSES.map((s) => <option key={s} value={s}>{STATUS_MAP[s]}</option>)}
        </select>
      </label>
      <label className="label">Priority
        <select className="input" value={priority} onChange={(e) => setPriority(Number(e.target.value) as PartPriority)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_MAP[p]}</option>
          ))}
        </select>
      </label>
      <label className="label">Notes
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {part.type === "part" && (
        <>
          <label className="label">Source material
            <input className="input" value={sourceMaterial} onChange={(e) => setSourceMaterial(e.target.value)} />
          </label>
          <label className="label">Quantity
            <input className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="label">Cut length
            <input className="input" value={cutLength} onChange={(e) => setCutLength(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={haveMaterial} onChange={(e) => setHaveMaterial(e.target.checked)} />
            Have material
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={drawingCreated} onChange={(e) => setDrawingCreated(e.target.checked)} />
            Drawing created
          </label>
        </>
      )}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tool, ToolCheckKind, ToolCondition, ToolStatus } from "@/lib/types";

const KINDS: ToolCheckKind[] = ["inspection", "maintenance", "repair"];
const CONDITIONS: ToolCondition[] = ["good", "fair", "poor"];
const STATUS_AFTER: ToolStatus[] = ["in_service", "needs_attention", "out_of_service"];

function nowDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Log a check row. `tools` is already due-first ordered, non-retired only (§6). */
export function ToolCheckForm({ tools }: { tools: Tool[] }) {
  const router = useRouter();
  const [toolId, setToolId] = useState(tools[0]?.id ?? "");
  const [checkedAt, setCheckedAt] = useState(nowDatetimeLocal());
  const [kind, setKind] = useState<ToolCheckKind>("inspection");
  const [condition, setCondition] = useState<ToolCondition>("good");
  const [statusAfter, setStatusAfter] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tool-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolId,
          checkedAt: checkedAt ? new Date(checkedAt).toISOString() : undefined,
          kind,
          condition,
          statusAfter: statusAfter || null,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        setCheckedAt(nowDatetimeLocal());
        setKind("inspection");
        setCondition("good");
        setStatusAfter("");
        setNotes("");
        router.refresh();
      } else {
        setError("Could not log this check — check the fields.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (tools.length === 0) {
    return <p className="card text-sm text-[var(--muted)]">No tools to log a check against.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">Tool
        <select className="input" value={toolId} onChange={(e) => setToolId(e.target.value)} required>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name}{t.assetTag ? ` — ${t.assetTag}` : ""}</option>)}
        </select>
      </label>
      <label className="label">Checked at<input className="input" type="datetime-local" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} required /></label>
      <label className="label">Kind
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ToolCheckKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="label">Condition
        <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as ToolCondition)}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="label">Set tool status to
        <select className="input" value={statusAfter} onChange={(e) => setStatusAfter(e.target.value)}>
          <option value="">— No change —</option>
          {STATUS_AFTER.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="label">Notes (optional)<input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary self-start">
        {busy ? "Logging…" : "Log check"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LinkOutcome = { kind: "error"; message: string };

export function FirstLinkPicker({
  firstPeopleId,
  people,
}: {
  firstPeopleId: number;
  people: { id: string; name: string }[];
}) {
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LinkOutcome | null>(null);
  const router = useRouter();

  async function link() {
    if (!personId) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/admin/first/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, firstPeopleId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        setOutcome({ kind: "error", message: "That FIRST record is already linked to someone else." });
      } else {
        setOutcome({ kind: "error", message: body?.error ?? `HTTP ${res.status}` });
      }
    } catch (error) {
      setOutcome({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="input"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        disabled={busy}
      >
        <option value="">Link to person…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn" onClick={link} disabled={busy || !personId}>
        {busy ? "Linking…" : "Link"}
      </button>
      {outcome && <span className="text-sm text-[var(--red)]">{outcome.message}</span>}
    </div>
  );
}

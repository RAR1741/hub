"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MemberManager({
  teamId,
  members,
  candidates,
}: {
  teamId: string;
  members: { personId: string; name: string; isManager: boolean }[];
  candidates: { id: string; name: string }[]; // people not yet on the team
}) {
  const [personId, setPersonId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(`/api/admin/teams/${teamId}/members`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      router.refresh();
      setPersonId("");
    } else {
      setStatus("Action failed.");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Members ({members.length})</h2>
      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {members.map((m) => (
          <li key={m.personId} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {m.name} {m.isManager ? "(manager)" : ""}
            </span>
            <span className="flex items-center gap-2">
              <button
                onClick={() => call("POST", { personId: m.personId, isManager: !m.isManager })}
                className="btn btn-secondary px-3 py-1"
              >
                {m.isManager ? "Remove manager" : "Make manager"}
              </button>
              <button onClick={() => call("DELETE", { personId: m.personId })} className="btn btn-danger px-3 py-1">
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <label className="label">
          Add member{" "}
          <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Choose…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <button disabled={!personId} onClick={() => call("POST", { personId, isManager: false })} className="btn btn-primary">
          Add
        </button>
      </div>
      {status && <p role="status" className="text-sm text-[var(--color-muted-fg)]">{status}</p>}
    </section>
  );
}

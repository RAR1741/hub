"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

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
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setStatus(null);
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Members ({members.length})</h2>
      {members.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No members yet — add one below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--hair)]">
          {members.map((m) => (
            <li key={m.personId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {m.name} {m.isManager ? "(manager)" : ""}
              </span>
              <span className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-1"
                  disabled={busy}
                  onClick={() => call("POST", { personId: m.personId, isManager: !m.isManager })}
                >
                  {m.isManager ? "Remove manager" : "Make manager"}
                </Button>
                <Button
                  variant="danger"
                  className="px-3 py-1"
                  disabled={busy}
                  onClick={() => call("DELETE", { personId: m.personId })}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
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
        <Button
          variant="primary"
          disabled={!personId}
          onClick={() => call("POST", { personId, isManager: false })}
          pending={busy}
          pendingLabel="Working…"
        >
          Add
        </Button>
      </div>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </section>
  );
}

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
    <section>
      <h2>Members ({members.length})</h2>
      <ul>
        {members.map((m) => (
          <li key={m.personId}>
            {m.name} {m.isManager ? "(manager)" : ""}{" "}
            <button onClick={() => call("POST", { personId: m.personId, isManager: !m.isManager })}>
              {m.isManager ? "Remove manager" : "Make manager"}
            </button>{" "}
            <button onClick={() => call("DELETE", { personId: m.personId })}>Remove</button>
          </li>
        ))}
      </ul>
      <label>
        Add member{" "}
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Choose…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <button disabled={!personId} onClick={() => call("POST", { personId, isManager: false })}>
        Add
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}

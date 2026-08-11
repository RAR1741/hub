"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountRequestActions({ requestId }: { requestId: string }) {
  const [studentId, setStudentId] = useState("");
  const [role, setRole] = useState("student");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function act(body: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(`/api/admin/requests/account/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) router.refresh();
    else if (res.status === 409) setStatus("Student ID or email already in use.");
    else setStatus("Action failed.");
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        className="input w-36"
        placeholder="Assign student ID"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      />
      <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="student">student</option>
        <option value="captain">captain</option>
      </select>
      <button
        disabled={!studentId.trim()}
        onClick={() => act({ action: "approve", studentIdNumber: studentId, role })}
        className="btn btn-primary px-3 py-1"
      >
        Approve
      </button>
      <button onClick={() => act({ action: "deny" })} className="btn btn-secondary px-3 py-1">Deny</button>
      {status && <span role="status" className="text-sm text-[var(--color-muted-fg)]"> {status}</span>}
    </span>
  );
}

export function ApplicationActions({ applicationId }: { applicationId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function act(action: "approve" | "deny") {
    setStatus(null);
    const res = await fetch(`/api/admin/requests/application/${applicationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) router.refresh();
    else setStatus("Action failed.");
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button onClick={() => act("approve")} className="btn btn-primary px-3 py-1">Approve</button>
      <button onClick={() => act("deny")} className="btn btn-secondary px-3 py-1">Deny</button>
      {status && <span role="status" className="text-sm text-[var(--color-muted-fg)]"> {status}</span>}
    </span>
  );
}

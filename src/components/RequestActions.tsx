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
    <span>
      <input
        placeholder="Assign student ID"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="student">student</option>
        <option value="captain">captain</option>
      </select>
      <button
        disabled={!studentId.trim()}
        onClick={() => act({ action: "approve", studentIdNumber: studentId, role })}
      >
        Approve
      </button>
      <button onClick={() => act({ action: "deny" })}>Deny</button>
      {status && <span role="status"> {status}</span>}
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
    <span>
      <button onClick={() => act("approve")}>Approve</button>
      <button onClick={() => act("deny")}>Deny</button>
      {status && <span role="status"> {status}</span>}
    </span>
  );
}

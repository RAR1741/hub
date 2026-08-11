"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JoinActionResult } from "@/lib/teams";

export function JoinButtons({
  teamId,
  action,
}: {
  teamId: string;
  action: JoinActionResult;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function post(path: string, body?: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) router.refresh();
    else if (res.status === 409) setStatus("You already have a pending application.");
    else setStatus("Action failed.");
  }

  if (action === "member") return <em className="badge badge-present">member</em>;
  if (action === "pending") return <em className="badge">application pending</em>;
  if (action === "join") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => post(`/api/teams/${teamId}/join`)}>
          Join
        </button>
        {status && (
          <span role="status" className="text-sm text-[var(--color-muted-fg)]">
            {status}
          </span>
        )}
      </span>
    );
  }
  if (action === "apply") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          className="input w-48"
          placeholder="Message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={() => post(`/api/teams/${teamId}/apply`, { message: message || undefined })}
        >
          Apply
        </button>
        {status && (
          <span role="status" className="text-sm text-[var(--color-muted-fg)]">
            {status}
          </span>
        )}
      </span>
    );
  }
  return null;
}

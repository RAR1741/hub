"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteTeamButton({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this team? Only possible when it has no sub-teams or members.")) return;
    const res = await fetch(`/api/admin/teams/${teamId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/admin/teams");
      router.refresh();
    } else if (res.status === 409) {
      setStatus("Team still has sub-teams or members — remove them first.");
    } else {
      setStatus("Delete failed.");
    }
  }

  return (
    <p>
      <button onClick={remove}>Delete team</button>
      {status && <span role="status"> {status}</span>}
    </p>
  );
}

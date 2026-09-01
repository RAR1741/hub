"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BadgeAwardPanel({
  personId,
  awardable,
}: {
  personId: string;
  awardable: { id: string; name: string; color: string }[];
}) {
  const router = useRouter();
  const [badgeId, setBadgeId] = useState(awardable[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (awardable.length === 0) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${personId}/badges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badgeId, note: note || undefined }),
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      } else if (res.status === 409) {
        setStatus("Already holds that badge.");
      } else {
        setStatus("Award failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="label">Badge
        <select className="input" value={badgeId} onChange={(e) => setBadgeId(e.target.value)}>
          {awardable.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>
      <label className="label">Note
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Awarding…" : "Award badge"}
      </button>
      {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
    </form>
  );
}

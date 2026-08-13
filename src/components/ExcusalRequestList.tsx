import type { ExcusalRequest } from "@/lib/types";

const PILL_VARIANT: Record<ExcusalRequest["status"], string> = {
  pending: "role",
  approved: "on",
  denied: "admin",
};

export function ExcusalRequestList({ requests }: { requests: ExcusalRequest[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No excusal requests yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mono">{r.date}</span>
          <span className={`pill ${PILL_VARIANT[r.status]}`}>{r.status}</span>
          {r.reason && <span className="text-[var(--muted)]">{r.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

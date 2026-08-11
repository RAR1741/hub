"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "present" | "excused" | "optional" | "absent";

/**
 * A single grid cell: shows the color-coded status and, on click, offers to add
 * a manual session (mark present) or toggle an excusal for (person, date).
 */
export function AttendanceCell({
  personId,
  date,
  status,
}: {
  personId: string;
  date: string;
  status: Status;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function addSession() {
    if (busy) return;
    setBusy(true);
    // A default 2-hour session at local noon UTC-ish; mentor refines on the flagged screen.
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        timeIn: `${date}T17:00:00Z`,
        timeOut: `${date}T19:00:00Z`,
        note: "added from calendar",
      }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function toggleExcusal() {
    if (busy) return;
    setBusy(true);
    const method = status === "excused" ? "DELETE" : "POST";
    const res = await fetch("/api/admin/excusals", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, date, note: "excused from calendar" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <td data-status={status} title={`${date}: ${status}`}>
      <span className="dot" aria-label={status} />
      <span className="cell-actions">
        <button type="button" disabled={busy} onClick={addSession}>+ session</button>
        <button type="button" disabled={busy} onClick={toggleExcusal}>
          {status === "excused" ? "unexcuse" : "excuse"}
        </button>
      </span>
    </td>
  );
}

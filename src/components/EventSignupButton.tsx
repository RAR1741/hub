"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReminderPicker } from "@/components/ReminderPicker";

export function EventSignupButton({
  eventId,
  initiallySignedUp,
}: {
  eventId: string;
  initiallySignedUp: boolean;
}) {
  const router = useRouter();
  const [signedUp, setSignedUp] = useState(initiallySignedUp);
  const [busy, setBusy] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<number[]>([]);
  // Tracks the prop this state was last derived from, so a change to
  // initiallySignedUp (router.refresh() after this or another tab's
  // action) can be adopted during render instead of via an effect.
  const [syncedFrom, setSyncedFrom] = useState(initiallySignedUp);
  if (syncedFrom !== initiallySignedUp) {
    setSyncedFrom(initiallySignedUp);
    setSignedUp(initiallySignedUp);
  }

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/signup`, {
        method: signedUp ? "DELETE" : "POST",
        ...(signedUp
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reminderMinutes }),
            }),
      });
      if (res.ok) setSignedUp(!signedUp);
      // Refresh even on failure (e.g. 409 already-signed-up/event-ended) —
      // the button should reflect whatever the server actually has.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!signedUp && (
        <details>
          <summary>Remind me before it starts</summary>
          <ReminderPicker
            value={reminderMinutes}
            onChange={setReminderMinutes}
            legend="Remind me before it starts (optional)"
            testIdPrefix="event-remind"
          />
        </details>
      )}
      <button
        disabled={busy}
        onClick={toggle}
        className={signedUp ? "btn btn-secondary px-3 py-1" : "btn btn-primary px-3 py-1"}
      >
        {busy ? "Working…" : signedUp ? "Cancel sign-up" : "Sign up"}
      </button>
    </div>
  );
}

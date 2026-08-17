"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/signup`, {
        method: signedUp ? "DELETE" : "POST",
      });
      if (res.ok) {
        setSignedUp(!signedUp);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      disabled={busy}
      onClick={toggle}
      className={signedUp ? "btn btn-secondary px-3 py-1" : "btn btn-primary px-3 py-1"}
    >
      {busy ? "Working…" : signedUp ? "Cancel sign-up" : "Sign up"}
    </button>
  );
}

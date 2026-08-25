"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASON_MAX = 500;

export function ExcusalRequestForm() {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "duplicate">("idle");
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/excusal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, reason: reason.trim() || undefined }),
      });
      if (res.ok) {
        setState("sent");
        setReason("");
        router.refresh();
      } else if (res.status === 409) {
        setState("duplicate");
      } else {
        setState("error");
      }
    } catch {
      // Network failure — fetch rejected. Don't leave the button stuck on "sending".
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="label">
        Date
        <input
          className="input"
          type="date"
          required
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setState("idle");
          }}
        />
      </label>
      <label className="label">
        Reason (optional)
        <textarea
          className="input"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setState("idle");
          }}
          placeholder="Why were you unable to attend?"
        />
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={state === "sending" || !date}>
        {state === "sending" ? "Submitting…" : "Request excusal"}
      </button>
      {state === "sent" && (
        <p role="status" className="text-sm" style={{ color: "var(--present)" }}>
          Request sent! A mentor will review it.
        </p>
      )}
      {state === "duplicate" && (
        <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
          You already have a pending request for that date.
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
          Something went wrong — try again.
        </p>
      )}
    </form>
  );
}

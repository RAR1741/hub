"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASON_MAX = 500;

export function ToolDeleteRequestForm({ toolId }: { toolId: string }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "duplicate">("idle");
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/tool-delete-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId, reason: reason.trim() }),
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
        Reason
        <textarea
          className="input"
          required
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setState("idle");
          }}
          placeholder="Why should this tool be deleted?"
        />
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={state === "sending" || !reason.trim()}>
        {state === "sending" ? "Submitting…" : "Request deletion"}
      </button>
      {state === "sent" && (
        <p role="status" className="text-sm" style={{ color: "var(--present)" }}>
          Request sent! A mentor will review it.
        </p>
      )}
      {state === "duplicate" && (
        <p role="alert" className="text-sm" style={{ color: "var(--absent)" }}>
          Already requested — a mentor hasn&apos;t reviewed it yet.
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

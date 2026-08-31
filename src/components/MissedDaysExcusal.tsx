"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const REASON_MAX = 500;

export function MissedDaysExcusal({
  missedDates,
  pendingDates,
}: {
  missedDates: string[];
  pendingDates: string[];
}) {
  const pending = new Set(pendingDates);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {missedDates.map((date) => (
          <li key={date} className="flex items-center justify-between gap-3">
            <span className="mono">{date}</span>
            {pending.has(date) ? (
              <span className="pill role">Pending excusal</span>
            ) : (
              <button
                type="button"
                className="text-sm font-medium text-[var(--red)]"
                onClick={() => setSelectedDate(date)}
              >
                Request excusal
              </button>
            )}
          </li>
        ))}
      </ul>
      {selectedDate && (
        <ExcusalModal date={selectedDate} onClose={() => setSelectedDate(null)} />
      )}
    </>
  );
}

function ExcusalModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error" | "duplicate">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        onClose();
        router.refresh();
      } else if (res.status === 409) {
        setState("duplicate");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Request excusal"
      onClick={onClose}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Request excusal</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              For <span className="mono">{date}</span>.
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2 mt-3">
          <label className="label">
            Reason (optional)
            <textarea
              ref={textareaRef}
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
          <button type="submit" className="btn btn-primary w-full" disabled={state === "sending"}>
            {state === "sending" ? "Submitting…" : "Request excusal"}
          </button>
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
      </div>
    </div>
  );
}

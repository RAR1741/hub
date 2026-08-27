"use client";

import { useEffect, useSyncExternalStore } from "react";
import { dismissError, getServerSnapshot, getSnapshot, installFetchPatch, subscribe } from "@/lib/activity";

const DOT_DELAYS = ["0ms", "150ms", "300ms"];

function Dots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-[var(--ink)] animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4 12 12M12 4 4 12" />
    </svg>
  );
}

export function ActivityIndicator() {
  useEffect(() => {
    installFetchPatch();
  }, []);

  const { phase } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-4 right-4 z-50">
      {phase === "loading" || phase === "saving" ? (
        <div className="flex items-center gap-2 rounded-full border border-[var(--hair)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] shadow-[var(--shadow)]">
          <Dots />
          {/* "Loading…" churns on every navigation — don't spam screen readers with it. */}
          <span aria-hidden={phase === "loading"}>{phase === "saving" ? "Saving…" : "Loading…"}</span>
        </div>
      ) : phase === "saved" ? (
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--present)] px-3 py-1.5 text-xs font-medium text-[var(--present-fg)]">
          <CheckIcon />
          Saved
        </div>
      ) : phase === "error" ? (
        <button
          type="button"
          onClick={dismissError}
          className="flex items-center gap-1.5 rounded-full bg-[var(--red)] px-3 py-1.5 text-xs font-medium text-[var(--red-fg)]"
        >
          <CrossIcon />
          Couldn&apos;t save
        </button>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type Entry = { name: string; since: string };

/** mm:ss for the first minute, then h:mm — matches the kiosk's mono duration format. */
function formatDuration(sinceIso: string, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - new Date(sinceIso).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

export function WhosHere({ initial }: { initial: Entry[] }) {
  const [here, setHere] = useState<Entry[]>(initial);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/whos-here", { cache: "no-store" });
        if (res.ok) setHere(((await res.json()).here as Entry[]) ?? []);
      } catch {
        // transient; keep last known list
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="card pit">
      <div className="card-head">
        <h3>In the shop</h3>
        <span className="count">{here.length} here</span>
      </div>
      <div role="status">
        {here.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-muted-fg)]">Nobody is signed in.</p>
        ) : (
          here.map((h, i) => (
            <div key={`${h.name}-${h.since}`} className="pit-row">
              <span className="idx">{String(i + 1).padStart(2, "0")}</span>
              <div className="nm">{h.name}</div>
              <span className="clock">
                <span className="live-dot" aria-hidden="true" />
                <span className="mono">{formatDuration(h.since, now)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

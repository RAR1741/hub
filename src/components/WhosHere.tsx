"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClockDuration } from "@/lib/format";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

type Entry = { name: string; since: string };

export function WhosHere({ initial }: { initial: Entry[] }) {
  const [here, setHere] = useState<Entry[]>(initial);
  const [now, setNow] = useState(() => Date.now());

  const refetchHere = useCallback(async () => {
    try {
      const res = await fetch("/api/whos-here", { cache: "no-store" });
      if (res.ok) setHere(((await res.json()).here as Entry[]) ?? []);
    } catch {
      // transient; keep last known list
    }
  }, []);

  useRealtimeRefetch("hub:presence", refetchHere);

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
          <p className="p-4 text-sm text-[var(--muted)]">Nobody is signed in.</p>
        ) : (
          here.map((h, i) => (
            <div key={`${h.name}-${h.since}`} className="pit-row">
              <span className="idx">{String(i + 1).padStart(2, "0")}</span>
              <div className="nm">{h.name}</div>
              <span className="clock">
                <span className="live-dot" aria-hidden="true" />
                <span className="mono">{formatClockDuration(h.since, now)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

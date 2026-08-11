"use client";

import { useEffect, useState } from "react";

type Entry = { name: string; since: string };

export function WhosHere({ initial }: { initial: Entry[] }) {
  const [here, setHere] = useState<Entry[]>(initial);

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

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">In the shop ({here.length})</h2>
      <div role="status">
        {here.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-fg)]">Nobody is signed in.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {here.map((h) => (
              <li
                key={`${h.name}-${h.since}`}
                className="flex items-center gap-2 py-2 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-present)]"
                />
                <span className="font-medium">{h.name}</span>
                <span className="text-[var(--color-muted-fg)]">
                  — since {new Date(h.since).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

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
    <section>
      <h2>In the shop ({here.length})</h2>
      {here.length === 0 ? (
        <p>Nobody is signed in.</p>
      ) : (
        <ul>
          {here.map((h) => (
            <li key={`${h.name}-${h.since}`}>
              {h.name} — since {new Date(h.since).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

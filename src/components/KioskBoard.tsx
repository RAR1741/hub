"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function KioskSetupForm() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch("/api/kiosk/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) { router.push("/kiosk"); router.refresh(); }
    else setStatus("Token not recognized.");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="label">
        Kiosk token
        <input
          className="input mt-1"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Register this tablet
      </button>
      {status && (
        <p role="alert" className="text-sm font-medium text-[var(--color-absent)]">
          {status}
        </p>
      )}
    </form>
  );
}

type Member = { id: string; name: string };
type Here = { personId: string; name: string; since: string };

export function KioskBoard({ members, here }: { members: Member[]; here: Here[] }) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const router = useRouter();

  async function call(path: string, personId: string, name: string, verb: string) {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    setBusy(false);
    if (res.ok) { setFlash(`${verb} ${name}`); router.refresh(); }
    else if (res.status === 401) { setFlash("This tablet is not registered."); }
    else {
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      setFlash(data.reason === "no_active_period" ? "No active period — ask a mentor." : "Try again.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {flash && (
        <p
          role="status"
          className="rounded-xl border border-[var(--color-brand)] bg-[var(--color-brand)] px-6 py-4 text-center text-xl font-bold text-[var(--color-brand-fg)] shadow-lg"
        >
          {flash}
        </p>
      )}
      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="card flex flex-col gap-4">
          <h2 className="text-2xl font-bold tracking-tight">
            Who&apos;s here ({here.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {here.map((h) => (
              <li key={h.personId}>
                <button
                  onClick={() => call("/api/kiosk/clock-out", h.personId, h.name, "Signed out")}
                  className="btn btn-secondary min-h-16 w-full text-lg leading-tight border-[var(--color-present)]"
                >
                  {h.name} — out
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card flex flex-col gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => call("/api/kiosk/clock-in", m.id, m.name, "Signed in")}
                  className="btn btn-primary min-h-16 w-full text-lg leading-tight"
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClockDuration } from "@/lib/format";

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
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  const nowDate = new Date(now);

  return (
    <div className="kiosk flex flex-1 flex-col">
      <div className="hazard" />
      <div className="kiosk-head">
        <div className="k-brand">
          <span
            className="rounded-md px-[7px] py-[3px] font-[family-name:var(--font-mono)] text-[13px] font-bold tracking-[0.02em]"
            style={{ background: "#E01926", color: "#ffffff" }}
          >
            1741
          </span>
          Sign in / out
        </div>
        <div className="k-now mono">
          {nowDate.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()} ·{" "}
          {nowDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·{" "}
          {here.length} here
        </div>
      </div>

      {flash && (
        <p
          role="status"
          className="mx-5 mt-4 rounded-xl border px-6 py-4 text-center text-xl font-bold shadow-lg"
          style={{ background: "#E01926", borderColor: "#E01926", color: "#ffffff" }}
        >
          {flash}
        </p>
      )}

      <div className="kiosk-body flex-1">
        <section className="k-signin">
          <p className="k-title">Tap your name to sign in</p>
          {members.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              Everyone active is already signed in.
            </p>
          ) : (
            <div className="k-grid">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => call("/api/kiosk/clock-in", m.id, m.name, "Signed in")}
                  className="k-name"
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="k-here">
          <p className="k-title">On the clock · {here.length}</p>
          {here.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              Nobody is signed in yet.
            </p>
          ) : (
            here.map((h) => (
              <button
                key={h.personId}
                type="button"
                disabled={busy}
                onClick={() => call("/api/kiosk/clock-out", h.personId, h.name, "Signed out")}
                className="k-out"
              >
                <span className="knm">{h.name}</span>
                <span className="kt mono">{formatClockDuration(h.since, now)}</span>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

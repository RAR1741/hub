"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClockDuration } from "@/lib/format";
import { roleColorVar } from "@/lib/roster-colors";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

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

type Member = { id: string; name: string; role: string };
type Here = { personId: string; name: string; since: string; role: string };

export function KioskBoard({
  students,
  mentors,
  here,
  canAct,
}: {
  students: Member[];
  mentors: Member[];
  here: Here[];
  canAct: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  const router = useRouter();

  useRealtimeRefetch("hub:presence", () => {
    if (!busyRef.current) router.refresh();
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss the sign in/out banner after 5s so it doesn't crowd the screen.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 5_000);
    return () => clearTimeout(id);
  }, [flash]);

  async function call(path: string, personId: string, name: string, verb: string) {
    if (busy || !canAct) return;
    setBusy(true);
    busyRef.current = true;
    setFlash(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    setBusy(false);
    busyRef.current = false;
    if (res.ok) {
      setFlash(`${verb} ${name}`);
      setSearch("");
      searchRef.current?.focus();
      router.refresh();
    }
    else if (res.status === 401) { setFlash("This tablet is not registered."); }
    else {
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      setFlash(data.reason === "no_active_period" ? "No active period — ask a mentor." : "Try again.");
    }
  }

  const q = search.trim().toLowerCase();
  const match = (name: string) => q === "" || name.toLowerCase().includes(q);
  const shownStudents = students.filter((m) => match(m.name));
  const shownMentors = mentors.filter((m) => match(m.name));
  const shownHere = here.filter((h) => match(h.name));

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || busy || q === "") return;
    const total = shownStudents.length + shownMentors.length + shownHere.length;
    if (total !== 1) return;
    e.preventDefault();
    if (shownHere.length === 1) {
      const h = shownHere[0];
      call("/api/kiosk/clock-out", h.personId, h.name, "Signed out");
    } else {
      const m = shownStudents[0] ?? shownMentors[0];
      call("/api/kiosk/clock-in", m.id, m.name, "Signed in");
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
        <p role="status" className="k-flash" style={{ visibility: flash ? "visible" : "hidden" }}>
          {flash ?? " "}
        </p>
        <div className="k-now mono">
          {nowDate.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()} ·{" "}
          {nowDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·{" "}
          {here.length} here
          {!canAct && (
            <span className="ml-2" style={{ color: "#8b919a" }}>
              · View only
            </span>
          )}
        </div>
      </div>

      <div className="kiosk-search-row">
        <input
          ref={searchRef}
          type="text"
          className="k-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoFocus
          placeholder="Search name…"
          aria-label="Search names"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="kiosk-body flex-1">
        <section className="k-signin">
          <p className="k-title">Tap your name to sign in</p>
          {students.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              Everyone active is already signed in.
            </p>
          ) : shownStudents.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              No match.
            </p>
          ) : (
            <div className="k-grid">
              {shownStudents.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy || !canAct}
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
          ) : shownHere.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              No match.
            </p>
          ) : (
            shownHere.map((h) => (
              <button
                key={h.personId}
                type="button"
                disabled={busy || !canAct}
                onClick={() => call("/api/kiosk/clock-out", h.personId, h.name, "Signed out")}
                className="k-out"
                data-role={h.role}
                style={{ borderLeftColor: roleColorVar(h.role), borderLeftWidth: 4 }}
              >
                <span className="knm">{h.name}</span>
                <span className="kt mono">{formatClockDuration(h.since, now)}</span>
              </button>
            ))
          )}
        </section>
        <section className="k-mentors">
          <p className="k-title">Mentor sign in</p>
          {mentors.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              All mentors are signed in.
            </p>
          ) : shownMentors.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b919a" }}>
              No match.
            </p>
          ) : (
            <div className="k-mentor-list">
              {shownMentors.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy || !canAct}
                  onClick={() => call("/api/kiosk/clock-in", m.id, m.name, "Signed in")}
                  className="k-name"
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

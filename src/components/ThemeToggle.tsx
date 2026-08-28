"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "hub-theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // While no explicit choice is stored we follow the OS, so re-render when it flips.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener("change", listener);
  };
}

function cookieTheme(): Theme | null {
  const m = document.cookie.match(/(?:^|;\s*)hub-theme=(light|dark)\b/);
  return m ? (m[1] as Theme) : null;
}

// No stored choice → reflect the current system theme; once the user picks, use that.
// localStorage is the fast path; the cookie is the fallback for guest/kiosk browsers
// that restrict DOM storage but keep cookies (see setTheme + the server-side apply in layout).
function getSnapshot(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return cookieTheme() ?? systemTheme();
  } catch {
    return cookieTheme() ?? "light";
  }
}

function getServerSnapshot(): Theme {
  return "light";
}

function setTheme(mode: Theme) {
  document.documentElement.setAttribute("data-theme", mode);
  // Cookie is the durable store: it survives guest/kiosk browsers that clear
  // localStorage on refresh, and the server reads it to apply the theme before
  // first paint (layout.tsx). One year, path=/, lax so it rides normal loads.
  document.cookie = `${STORAGE_KEY}=${mode}; path=/; max-age=31536000; samesite=lax`;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore storage failures — the cookie + attribute still apply
  }
  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const options: { key: Theme; label: string }[] = [
    { key: "light", label: "Light" },
    { key: "dark", label: "Dark" },
  ];

  return (

    <div
      role="group"
      aria-label="Theme"
      className="inline-flex gap-0.5 rounded-full border p-[3px]"
      style={{ background: "var(--steel-soft)", borderColor: "var(--hair)" }}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={mode === opt.key}
          onClick={() => setTheme(opt.key)}
          className="rounded-full px-3 py-1.5 text-xs font-semibold"
          style={
            mode === opt.key
              ? {
                  background: "var(--surface)",
                  color: "var(--ink)",
                  boxShadow: "var(--shadow)",
                }
              : { background: "transparent", color: "var(--muted)" }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>

  );
}

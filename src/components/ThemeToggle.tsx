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

// No stored choice → reflect the current system theme; once the user picks, use that.
function getSnapshot(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return systemTheme();
  } catch {
    return "light";
  }
}

function getServerSnapshot(): Theme {
  return "light";
}

function setTheme(mode: Theme) {
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore storage failures — the attribute still applies for this session
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

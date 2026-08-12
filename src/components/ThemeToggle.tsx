"use client";

import { useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "hub-theme";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function getServerSnapshot(): ThemeMode {
  return "system";
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    root.setAttribute("data-theme", mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }
  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function choose(next: ThemeMode) {
    applyTheme(next);
  }

  const options: { key: ThemeMode; label: string }[] = [
    { key: "light", label: "Light" },
    { key: "dark", label: "Dark" },
    { key: "system", label: "System" },
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
          onClick={() => choose(opt.key)}
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

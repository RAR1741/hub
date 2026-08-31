"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";

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

// Single sun/moon icon button. The icon shows the theme you'd switch TO: a moon
// while light, a sun while dark. One click sets an explicit choice (light↔dark),
// leaving the "follow the OS" state only ever entered by never having clicked.
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="tb-btn"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon name={mode === "dark" ? "sun" : "moon"} className="ic" />
    </button>
  );
}

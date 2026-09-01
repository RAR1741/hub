"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/Icon";

const STORAGE_KEY = "hub-nav";

// Flip the sidebar between expanded (.sb) and collapsed icon-rail (.rail).
// No React state: both navs are always in the DOM and CSS keys off the
// [data-nav="collapsed"] attribute on <html>, so toggling the attribute is the
// whole job. Cookie is the durable store the server reads before first paint
// (layout.tsx); localStorage covers the inline no-flash script's fast path.
function setNav(collapsed: boolean) {
  const val = collapsed ? "collapsed" : "expanded";
  document.documentElement.setAttribute("data-nav", val);
  document.cookie = `${STORAGE_KEY}=${val}; path=/; max-age=31536000; samesite=lax`;
  try {
    localStorage.setItem(STORAGE_KEY, val);
  } catch {
    // ignore storage failures — the cookie + attribute still apply
  }
}

function toggleNav() {
  setNav(document.documentElement.getAttribute("data-nav") !== "collapsed");
}

export function SidebarToggle({ variant }: { variant: "collapse" | "expand" }) {
  if (variant === "expand") {
    return (
      <button
        type="button"
        className="rail-i"
        onClick={toggleNav}
        aria-label="Expand sidebar"
        title="Expand sidebar ([)"
      >
        <Icon name="chevron" className="ic" />
      </button>
    );
  }
  return (
    <button type="button" className="sb-collapse" onClick={toggleNav} aria-label="Collapse sidebar">
      <Icon name="chevron" className="ic" style={{ transform: "rotate(180deg)" }} />
      Collapse
      <kbd>[</kbd>
    </button>
  );
}

// Registers the `[` keyboard shortcut for toggling the sidebar. Renders nothing;
// mounted once in the layout. Ignores the keystroke while typing in a field.
export function SidebarKeyShortcut() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      toggleNav();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

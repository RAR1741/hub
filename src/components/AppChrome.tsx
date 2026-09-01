"use client";

import { usePathname } from "next/navigation";
import { ActivityIndicator } from "@/components/ActivityIndicator";

/**
 * App shell: grouped left sidebar beside the main content column. The /onshape
 * panel routes render clean (no sidebar, no banner) — that panel is a ~350px
 * iframe embedded in Onshape. `usePathname()` is SSR-consistent in the App
 * Router, so server and client agree on the omission (no hydration mismatch).
 *
 * `sidebar` and `banner` are passed as props (rendered on the server) so the
 * async server components (SiteNav, MasqueradeBanner) compose into this client
 * shell without becoming client components themselves.
 */
export function AppShell({
  sidebar,
  topbar,
  banner,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  banner: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPanel = pathname === "/onshape" || pathname?.startsWith("/onshape/");

  if (isPanel) {
    // Onshape panel: full narrow width, no hub chrome.
    return (
      <div id="main" className="flex flex-1 flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {sidebar}
      <div className="app-main-col">
        {topbar}
        {banner}
        <div
          id="main"
          className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6"
        >
          {children}
        </div>
      </div>
      <ActivityIndicator />
    </div>
  );
}

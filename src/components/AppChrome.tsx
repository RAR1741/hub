"use client";

import { usePathname } from "next/navigation";
import { ActivityIndicator } from "@/components/ActivityIndicator";

/**
 * Hides the global hub chrome (nav, masquerade banner) on the /onshape panel
 * routes — that panel is a ~350px iframe embedded in Onshape and must render
 * clean. `usePathname()` is SSR-consistent in the App Router, so server and
 * client agree on the omission and there's no hydration mismatch.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/onshape" || pathname?.startsWith("/onshape/")) return null;
  return (
    <>
      {children}
      <ActivityIndicator />
    </>
  );
}

/** Same panel-route check for the `#main` content wrapper — the onshape
 * panel wants full narrow width, not the hub's centered max-width column. */
export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPanel = pathname === "/onshape" || pathname?.startsWith("/onshape/");
  return (
    <div id="main" className={isPanel ? "flex-1 flex flex-col" : "mx-auto w-full max-w-6xl flex-1 px-4 py-6 flex flex-col"}>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Wraps the mobile "More" sheet's <details> so it closes on client-side
 * navigation. SiteNav lives in the root layout (a server component that
 * never re-renders on soft nav — see the comment in NavLink.tsx), so an
 * uncontrolled <details> left open stays open after a sheet link is tapped.
 * All role gating stays server-side; this only tracks open/closed state.
 */
export function MoreSheet({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}

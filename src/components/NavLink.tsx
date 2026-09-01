"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * Nav item that marks itself active from the current path. SiteNav lives in the
 * root layout (a server component that never re-renders on client navigation),
 * so active state must be computed client-side here — this is the only JS the
 * sidebar needs; the flyout submenus stay pure CSS (:hover / :focus-within).
 */
export function NavLink({
  href,
  className,
  activeClassName = "active",
  exact = false,
  children,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  activeClassName?: string;
  // `exact` for "/" (Home), which otherwise prefix-matches every route.
  exact?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={active && activeClassName ? `${className ?? ""} ${activeClassName}` : className}
      aria-current={active ? "page" : undefined}
      {...rest}
    >
      {children}
    </Link>
  );
}

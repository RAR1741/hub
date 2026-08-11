import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";

const navLinkClass =
  "rounded-md px-2 py-1 text-sm font-medium text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-canvas)] hover:text-[var(--color-fg)] hover:no-underline";

export async function SiteNav() {
  const viewer = await getViewer();
  return (
    <nav className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3">
        <Link
          href="/"
          className="mr-2 text-base font-bold tracking-tight text-[var(--color-fg)] hover:no-underline"
        >
          Team Hub
        </Link>
        <div className="flex flex-wrap items-center gap-x-1">
          <Link href="/" className={navLinkClass}>
            Home
          </Link>{" "}
          <Link href="/people" className={navLinkClass}>
            People
          </Link>{" "}
          <Link href="/teams" className={navLinkClass}>
            Teams
          </Link>{" "}
          <Link href="/kiosk" className={navLinkClass}>
            Kiosk
          </Link>{" "}
          <Link href="/leaderboard" className={navLinkClass}>
            Leaderboard
          </Link>{" "}
          {hasRole(viewer.role, "mentor") && (
            <Link href="/admin/sessions/flagged" className={navLinkClass}>
              Flagged sessions
            </Link>
          )}{" "}
          {hasRole(viewer.role, "admin") && (
            <>
              <Link href="/admin/people" className={navLinkClass}>
                Admin: People
              </Link>{" "}
              <Link href="/admin/teams" className={navLinkClass}>
                Admin: Teams
              </Link>{" "}
              <Link href="/admin/requests" className={navLinkClass}>
                Admin: Requests
              </Link>{" "}
              <Link href="/admin/periods" className={navLinkClass}>
                Admin: Periods
              </Link>{" "}
              <Link href="/admin/kiosk-devices" className={navLinkClass}>
                Admin: Kiosk
              </Link>{" "}
              <Link href="/admin/settings" className={navLinkClass}>
                Admin: Settings
              </Link>{" "}
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {viewer.person ? (
            <span className="text-sm text-[var(--color-muted-fg)]">
              {viewer.person.displayName ?? viewer.person.firstName} ({viewer.role})
            </span>
          ) : (
            <Link href="/login" className="btn btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

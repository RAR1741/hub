import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { ThemeToggle } from "@/components/ThemeToggle";

const navLinkClass =
  "rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--steel-soft)] hover:text-[var(--ink)] hover:no-underline";

export async function SiteNav() {
  const viewer = await getViewer();
  const initials = viewer.person
    ? (viewer.person.displayName ?? viewer.person.firstName ?? "")
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <div className="sticky top-0 z-10">
      <div className="hazard" />
      <nav className="border-b border-[var(--hair)] bg-[var(--surface)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--surface)]/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2.5">
          <Link
            href="/"
            className="mr-2 flex items-center gap-2.5 font-[family-name:var(--font-display)] text-base font-extrabold tracking-tight text-[var(--ink)] hover:no-underline"
          >
            <span
              className="rounded-md px-[7px] py-[3px] font-[family-name:var(--font-mono)] text-[13px] font-bold tracking-[0.02em]"
              style={{ background: "var(--red)", color: "var(--red-fg)" }}
            >
              1741
            </span>
            Team Hub
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-x-1">
            <Link href="/" className={navLinkClass}>
              Home
            </Link>{" "}
            {hasRole(viewer.role, "student") && (
              <Link href="/people" className={navLinkClass}>
                People
              </Link>
            )}{" "}
            {hasRole(viewer.role, "student") && (
              <Link href="/teams" className={navLinkClass}>
                Teams
              </Link>
            )}{" "}
            <Link href="/kiosk" className={navLinkClass}>
              Kiosk
            </Link>{" "}
            <Link href="/leaderboard" className={navLinkClass}>
              Leaderboard
            </Link>{" "}
            {hasRole(viewer.role, "mentor") && (
              <Link href="/admin" className={navLinkClass}>
                Admin
              </Link>
            )}{" "}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            {viewer.person ? (
              <span className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
                <span
                  className="grid h-[27px] w-[27px] place-items-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: "var(--steel)" }}
                  aria-hidden="true"
                >
                  {initials}
                </span>
                {viewer.person.displayName ?? viewer.person.firstName} (
                {viewer.role})
              </span>
            ) : (
              <Link href="/login" className="btn btn-primary">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}

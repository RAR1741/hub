import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { ThemeToggle } from "@/components/ThemeToggle";

const navLinkClass =
  "rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--steel-soft)] hover:text-[var(--ink)] hover:no-underline";

export async function SiteNav() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  // Show the Kiosk link on a registered tablet no matter who's logged in, so a
  // guest who navigates away can get back without typing /kiosk. No kiosk cookie
  // → verifyKioskToken short-circuits to false with no DB hit.
  const [viewer, kioskRegistered] = await Promise.all([getViewer(), verifyKioskToken(token)]);
  const initials = viewer.person
    ? `${viewer.person.firstName ?? ""} ${viewer.person.lastName ?? ""}`
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
          <Link href="/" className="mr-2 flex items-center hover:no-underline">
            <span className="flex items-center rounded-md border border-black/5 bg-white px-2 py-1 shadow-sm">
              <Image
                src="/redalert-logo.png"
                alt="Red Alert Robotics 1741"
                width={116}
                height={32}
                priority
              />
            </span>
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-x-1">
            <Link href="/" className={navLinkClass}>
              Home
            </Link>{" "}
            {hasRole(viewer.role, "mentor") && (
              <Link href="/people" className={navLinkClass}>
                People
              </Link>
            )}{" "}
            {hasRole(viewer.role, "student") && (
              <Link href="/teams" className={navLinkClass}>
                Teams
              </Link>
            )}{" "}
            {hasRole(viewer.role, "student") && (
              <Link href="/events" className={navLinkClass}>
                Events
              </Link>
            )}{" "}
            {(hasRole(viewer.role, "mentor") || kioskRegistered) && (
              <Link href="/kiosk" className={navLinkClass}>
                Kiosk
              </Link>
            )}{" "}
            <Link href="/leaderboard" className={navLinkClass}>
              Leaderboard
            </Link>{" "}
            {hasRole(viewer.role, "student") && (
              <Link href="/shop" className={navLinkClass}>
                Shop
              </Link>
            )}{" "}
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
                <Link
                  href={`/people/${viewer.person.id}`}
                  className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--ink)] hover:no-underline"
                >
                  <span
                    className="grid h-[27px] w-[27px] place-items-center rounded-full text-[12px] font-bold text-white"
                    style={{ background: "var(--steel)" }}
                    aria-hidden="true"
                  >
                    {initials}
                  </span>
                  {viewer.person.firstName} {viewer.person.lastName} (
                  {viewer.role})
                </Link>
                {/* Native POST so sign-out works without client JS; the route
                    clears the student-session + sb-* auth cookies server-side. */}
                <form action="/api/auth/logout" method="post" className="contents">
                  <button type="submit" className={navLinkClass}>
                    Sign out
                  </button>
                </form>
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

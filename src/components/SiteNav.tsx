import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import type { Role } from "@/lib/types";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink } from "@/components/NavLink";
import { Icon } from "@/components/ui/Icon";
import { MoreSheet } from "@/components/ui/MoreSheet";

// Admin subpages surfaced in the Admin flyout. Each row is gated to the same
// role its card requires on /admin (src/app/admin/page.tsx); a mentor must not
// even see a link to an admin-only page (authz e2e asserts count 0 page-wide).
const ADMIN_ITEMS: { label: string; href: string; role: Role }[] = [
  // Review — mentor+
  { label: "Requests", href: "/admin/requests", role: "mentor" },
  { label: "Flagged sessions", href: "/admin/sessions/flagged", role: "mentor" },
  { label: "Reports", href: "/admin/reports", role: "mentor" },
  // Roster — admin
  { label: "People", href: "/admin/people", role: "admin" },
  { label: "Teams", href: "/admin/teams", role: "admin" },
  { label: "Badges", href: "/admin/badges", role: "admin" },
  { label: "Time import", href: "/admin/time-import", role: "admin" },
  { label: "Application import", href: "/admin/application-import", role: "admin" },
  // Time — mentor+ except where noted
  { label: "Meetings", href: "/admin/meetings", role: "admin" },
  { label: "Build days", href: "/admin/build-days", role: "mentor" },
  { label: "Sessions", href: "/admin/sessions", role: "mentor" },
  { label: "Events", href: "/admin/events", role: "mentor" },
  { label: "Forms", href: "/admin/forms", role: "mentor" },
  { label: "Parts", href: "/admin/projects", role: "mentor" },
  { label: "Periods", href: "/admin/periods", role: "admin" },
  // Config — admin
  { label: "Kiosk devices", href: "/admin/kiosk-devices", role: "admin" },
  { label: "Drive group sync", href: "/admin/drive-sync", role: "admin" },
  { label: "FIRST roster status", href: "/admin/first-status", role: "admin" },
  { label: "Slack", href: "/admin/slack", role: "admin" },
  { label: "Settings", href: "/admin/settings", role: "admin" },
  { label: "Cron jobs", href: "/admin/cron", role: "admin" },
];

// Per-group signature hue (Task 1 tokens). Typed loosely so the CSS var passes.
const grp = (hue: string) => ({ ["--grp" as string]: `var(${hue})` }) as React.CSSProperties;

export async function SiteNav() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  // Show the Kiosk link on a registered tablet no matter who's logged in, so a
  // guest who navigates away can get back without typing /kiosk. No kiosk cookie
  // → verifyKioskToken short-circuits to false with no DB hit.
  const [viewer, kioskRegistered] = await Promise.all([getViewer(), verifyKioskToken(token)]);
  const role = viewer.role;
  const isStudent = hasRole(role, "student");
  const isMentor = hasRole(role, "mentor");
  const isAdmin = hasRole(role, "admin");

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

  const adminItems = ADMIN_ITEMS.filter((item) => hasRole(role, item.role));
  const showShopFloor = isMentor || kioskRegistered || isStudent;
  const showTeam = isMentor || isStudent;

  // ---- mobile bottom tab bar: same role gates as the sidebar above, just
  // collapsed to one primary link per group (the rest live in the More sheet). ----
  const shopPrimary = isMentor || kioskRegistered
    ? { label: "Kiosk", href: "/kiosk", icon: "tablet" as const }
    : isStudent
      ? { label: "Shop", href: "/shop", icon: "wrench" as const }
      : null;
  const teamPrimary = isMentor
    ? { label: "People", href: "/people", icon: "users" as const }
    : isStudent
      ? { label: "Teams", href: "/teams", icon: "layers" as const }
      : null;
  const primaryTabs: { label: string; href: string; icon: Parameters<typeof Icon>[0]["name"]; exact?: boolean }[] = [
    { label: "Home", href: "/", icon: "home", exact: true },
    ...(shopPrimary ? [shopPrimary] : []),
    ...(teamPrimary ? [teamPrimary] : []),
    { label: "Leaderboard", href: "/leaderboard", icon: "chart" },
  ];
  const tabCount = primaryTabs.length + 1; // + the More tab

  // Whatever a primary slot didn't claim still needs a home in the sheet.
  const showShopInSheet = isStudent && shopPrimary?.href !== "/shop";
  const showTeamsInSheet = isStudent && teamPrimary?.href !== "/teams";
  const showEventsInSheet = isStudent;

  return (
    <>
      <nav className="sb" aria-label="Primary">
      <div className="sb-brand">
        <Link href="/" className="flex items-center hover:no-underline">
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
      </div>

      <div className="sb-scroll">
        {/* Overview — always visible (Home + Leaderboard are public) */}
        <div className="sb-group" style={grp("--hue-overview")}>
          <h5>Overview</h5>
          <NavLink href="/" exact className="sbi">
            <Icon name="home" className="ic" />
            Home
          </NavLink>
          <NavLink href="/leaderboard" className="sbi">
            <Icon name="chart" className="ic" />
            Leaderboard
          </NavLink>
        </div>

        {showShopFloor && (
          <div className="sb-group" style={grp("--hue-shopfloor")}>
            <h5>Shop floor</h5>
            {(isMentor || kioskRegistered) && (
              <NavLink href="/kiosk" className="sbi">
                <Icon name="tablet" className="ic" />
                Kiosk
              </NavLink>
            )}
            {isStudent && (
              <NavLink href="/shop" className="sbi">
                <Icon name="wrench" className="ic" />
                Shop
              </NavLink>
            )}
          </div>
        )}

        {showTeam && (
          <div className="sb-group" style={grp("--hue-team")}>
            <h5>Team</h5>
            {isMentor && (
              <div className="sbi-wrap">
                <NavLink href="/people" className="sbi" aria-haspopup="true">
                  <Icon name="users" className="ic" />
                  People
                  <Icon name="chevron-down" className="flychev" />
                </NavLink>
                <div className="flyout" role="menu">
                  <NavLink href="/people" className="fly-link" role="menuitem">
                    All people
                  </NavLink>
                  {isAdmin && (
                    <NavLink href="/admin/people/duplicates" className="fly-link" role="menuitem">
                      Duplicates
                    </NavLink>
                  )}
                  {isAdmin && (
                    <NavLink href="/admin/people/import" className="fly-link" role="menuitem">
                      Import CSV
                    </NavLink>
                  )}
                </div>
              </div>
            )}
            {isStudent && (
              <NavLink href="/teams" className="sbi">
                <Icon name="layers" className="ic" />
                Teams
              </NavLink>
            )}
            {isStudent && (
              <div className="sbi-wrap">
                <NavLink href="/events" className="sbi" aria-haspopup="true">
                  <Icon name="calendar" className="ic" />
                  Events
                  <Icon name="chevron-down" className="flychev" />
                </NavLink>
                <div className="flyout" role="menu">
                  <NavLink href="/events" className="fly-link" role="menuitem">
                    Upcoming
                  </NavLink>
                  {isMentor && (
                    <NavLink href="/calendar" className="fly-link" role="menuitem">
                      Calendar
                    </NavLink>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {isMentor && (
          <div className="sb-group" style={grp("--hue-admin")}>
            <h5>Admin</h5>
            <div className="sbi-wrap">
              <NavLink href="/admin" className="sbi" aria-haspopup="true">
                <Icon name="sliders" className="ic" />
                Admin
                <Icon name="chevron-down" className="flychev" />
              </NavLink>
              <div className="flyout" role="menu">
                <div className="fly-title">Admin</div>
                <div className="fly-scroll">
                  {adminItems.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      className="fly-link"
                      role="menuitem"
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="sb-foot">
        <ThemeToggle />
        {viewer.person ? (
          <>
            <Link href={`/people/${viewer.person.id}`} className="sbi">
              <span
                className="grid h-[27px] w-[27px] flex-none place-items-center rounded-full text-[12px] font-bold text-white"
                style={{ background: "var(--steel)" }}
                aria-hidden="true"
              >
                {initials}
              </span>
              <span className="min-w-0 truncate">
                {viewer.person.firstName} {viewer.person.lastName}
                <span className="text-[var(--muted)]"> · {viewer.role}</span>
              </span>
            </Link>
            {/* Native POST so sign-out works without client JS; the route
                clears the student-session + sb-* auth cookies server-side. */}
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="sbi w-full cursor-pointer border-0 bg-transparent text-left"
              >
                <Icon name="x" className="ic" />
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        )}
      </div>
      </nav>

      {/* Mobile bottom tab bar — sibling of .sb; CSS shows one or the other by
          breakpoint (see globals.css .app-shell). Same role gates as above,
          collapsed to one primary link per group; the rest live in the More
          sheet below. The sheet's open/close state lives in MoreSheet (a tiny
          client component that closes it on route change — SiteNav itself
          never re-renders on soft nav); all gating below stays server-side. */}
      <nav className="tabbar" aria-label="Primary (mobile)" style={{ gridTemplateColumns: `repeat(${tabCount}, 1fr)` }}>
        {primaryTabs.map((tab) => (
          <NavLink key={tab.href} href={tab.href} exact={tab.exact} className="tab">
            <Icon name={tab.icon} className="ic" />
            {tab.label}
          </NavLink>
        ))}
        <MoreSheet className="more-sheet">
          <summary className="tab">
            {/* Icon component has no "dots" glyph; sliders is the nearest existing icon. */}
            <Icon name="sliders" className="ic" />
            More
          </summary>
          <div className="sheet">
            <div className="handle" />
            <h6>More</h6>
            {showTeamsInSheet && (
              <Link href="/teams" className="sheet-i">
                <Icon name="layers" className="ic" style={{ color: "var(--hue-team)" }} />
                Teams
              </Link>
            )}
            {showEventsInSheet && (
              <Link href="/events" className="sheet-i">
                <Icon name="calendar" className="ic" style={{ color: "var(--hue-team)" }} />
                Events
              </Link>
            )}
            {isMentor && (
              // /calendar has no other entry point (desktop-only Events flyout sub-link) —
              // dropping it here would narrow a mentor's reachable surface vs. desktop.
              <Link href="/calendar" className="sheet-i">
                <Icon name="calendar" className="ic" style={{ color: "var(--hue-team)" }} />
                Calendar
              </Link>
            )}
            {showShopInSheet && (
              <Link href="/shop" className="sheet-i">
                <Icon name="wrench" className="ic" style={{ color: "var(--hue-shopfloor)" }} />
                Shop
              </Link>
            )}
            {isMentor && (
              <Link href="/admin" className="sheet-i">
                <Icon name="sliders" className="ic" style={{ color: "var(--hue-admin)" }} />
                Admin
                <span className="pill admin">Admin</span>
              </Link>
            )}
            <div className="sheet-sep" />
            <div className="sheet-theme">
              Theme
              <ThemeToggle />
            </div>
            {viewer.person ? (
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="sheet-i w-full cursor-pointer border-0 bg-transparent"
                >
                  <Icon name="x" className="ic" />
                  Sign out
                </button>
              </form>
            ) : (
              <Link href="/login" className="sheet-i">
                Sign in
              </Link>
            )}
          </div>
        </MoreSheet>
      </nav>
    </>
  );
}

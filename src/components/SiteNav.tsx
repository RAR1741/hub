import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import type { Role } from "@/lib/types";
import { KIOSK_COOKIE, verifyKioskToken } from "@/lib/kiosk";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink } from "@/components/NavLink";
import { SidebarToggle } from "@/components/SidebarToggle";
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
  { label: "GitHub team sync", href: "/admin/github-sync", role: "admin" },
  { label: "FIRST roster status", href: "/admin/first-status", role: "admin" },
  { label: "Slack", href: "/admin/slack", role: "admin" },
  { label: "Settings", href: "/admin/settings", role: "admin" },
  { label: "Cron jobs", href: "/admin/cron", role: "admin" },
];

// Per-group signature hue (Task 1 tokens). Typed loosely so the CSS var passes.
const grp = (hue: string) => ({ ["--grp" as string]: `var(${hue})` }) as React.CSSProperties;

type IconName = Parameters<typeof Icon>[0]["name"];

// A sidebar item with a hover flyout of sub-links. If the viewer's role leaves
// only a single sub-link that goes to the same place as the item itself, the
// flyout is pure redundancy — render a plain link (no chevron, no flyout).
function NavItemWithFlyout({
  href,
  icon,
  label,
  items,
}: {
  href: string;
  icon: IconName;
  label: string;
  items: { label: string; href: string }[];
}) {
  const collapse = items.length === 1 && items[0].href === href;
  if (collapse) {
    return (
      <NavLink href={href} className="sbi">
        <Icon name={icon} className="ic" />
        {label}
      </NavLink>
    );
  }
  return (
    <div className="sbi-wrap">
      <NavLink href={href} className="sbi" aria-haspopup="true">
        <Icon name={icon} className="ic" />
        {label}
        <Icon name="chevron-down" className="flychev" />
      </NavLink>
      <div className="flyout" role="menu">
        {items.map((item) => (
          <NavLink key={item.href} href={item.href} className="fly-link" role="menuitem">
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

// A single icon in the collapsed rail. Icon-only items get a native `title`
// tooltip; items with sub-links get the same hover flyout as the expanded nav
// (with a label header, since the icon alone carries no text). Honors the same
// redundant-single-item collapse rule as NavItemWithFlyout.
function RailItem({
  href,
  icon,
  label,
  hue,
  exact,
  items,
  scroll,
}: {
  href: string;
  icon: IconName;
  label: string;
  hue: string;
  exact?: boolean;
  items?: { label: string; href: string }[];
  scroll?: boolean;
}) {
  const showFlyout =
    !!items && (items.length > 1 || (items.length === 1 && items[0].href !== href));
  if (!showFlyout) {
    return (
      <NavLink href={href} exact={exact} className="rail-i" aria-label={label} title={label} style={grp(hue)}>
        <Icon name={icon} className="ic" />
      </NavLink>
    );
  }
  const links = items!.map((item) => (
    <NavLink key={item.href} href={item.href} className="fly-link" role="menuitem">
      {item.label}
    </NavLink>
  ));
  return (
    <div className="rail-i-wrap" style={grp(hue)}>
      <NavLink href={href} exact={exact} className="rail-i" aria-label={label} title={label} aria-haspopup="true">
        <Icon name={icon} className="ic" />
      </NavLink>
      <div className="rail-fly" role="menu">
        <div className="fly-head">
          <Icon name={icon} className="ic" />
          {label}
        </div>
        {scroll ? <div className="fly-scroll">{links}</div> : links}
      </div>
    </div>
  );
}

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

  const adminItems = ADMIN_ITEMS.filter((item) => hasRole(role, item.role));

  // Flyout sub-links, gated by role. NavItemWithFlyout drops the flyout when a
  // viewer is left with only the redundant same-as-parent link.
  const peopleItems = [
    { label: "All people", href: "/people" },
    ...(isAdmin
      ? [
          { label: "Duplicates", href: "/admin/people/duplicates" },
          { label: "Import CSV", href: "/admin/people/import" },
        ]
      : []),
  ];
  const eventsItems = [
    { label: "Upcoming", href: "/events" },
    ...(isMentor ? [{ label: "Calendar", href: "/calendar" }] : []),
  ];
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
              <NavItemWithFlyout href="/people" icon="users" label="People" items={peopleItems} />
            )}
            {isStudent && (
              <NavLink href="/teams" className="sbi">
                <Icon name="layers" className="ic" />
                Teams
              </NavLink>
            )}
            {isStudent && (
              <NavItemWithFlyout href="/events" icon="calendar" label="Events" items={eventsItems} />
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

      {/* Identity (theme toggle, avatar, name/role, sign out) lives in the top
          bar now — see SiteTopbar. The footer keeps only the collapse control. */}
      <div className="sb-foot">
        <SidebarToggle variant="collapse" />
      </div>
      </nav>

      {/* Collapsed icon rail — sibling of .sb; CSS shows exactly one of the two
          based on <html data-nav>. Same role gates and same redundant-flyout
          rule as the expanded nav, just icon-only with hover flyouts. Hidden on
          mobile (the tab bar wins there). */}
      <nav className="rail" aria-label="Primary (collapsed)">
        <span className="badge-1741" aria-hidden="true">1741</span>

        {/* Overview */}
        <RailItem href="/" exact icon="home" label="Home" hue="--hue-overview" />
        <RailItem href="/leaderboard" icon="chart" label="Leaderboard" hue="--hue-overview" />

        {showShopFloor && <div className="rail-sep" />}
        {(isMentor || kioskRegistered) && (
          <RailItem href="/kiosk" icon="tablet" label="Kiosk" hue="--hue-shopfloor" />
        )}
        {isStudent && <RailItem href="/shop" icon="wrench" label="Shop" hue="--hue-shopfloor" />}

        {showTeam && <div className="rail-sep" />}
        {isMentor && (
          <RailItem href="/people" icon="users" label="People" hue="--hue-team" items={peopleItems} />
        )}
        {isStudent && <RailItem href="/teams" icon="layers" label="Teams" hue="--hue-team" />}
        {isStudent && (
          <RailItem href="/events" icon="calendar" label="Events" hue="--hue-team" items={eventsItems} />
        )}

        {isMentor && <div className="rail-sep" />}
        {isMentor && (
          <RailItem
            href="/admin"
            icon="sliders"
            label="Admin"
            hue="--hue-admin"
            items={adminItems}
            scroll
          />
        )}

        {/* Identity moved to the top bar (SiteTopbar); rail keeps only expand. */}
        <div className="rail-foot">
          <SidebarToggle variant="expand" />
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

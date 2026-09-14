import type { Role } from "./types";
import { hasRole } from "./authz";

export type NavGroup = "Overview" | "Shop floor" | "Team" | "Admin";

// A Role gate means hasRole(viewer, gate); "guest" is rank 0 so it's
// satisfied by every viewer, including an unauthenticated one — that's how a
// "public" item (Home, Leaderboard) is represented, no separate sentinel
// needed. "kiosk" is the one gate that isn't a plain role check: mentor+ OR a
// registered kiosk device (see NavContext.kioskRegistered).
export type NavGate = Role | "kiosk";

// Second-level grouping for the Admin flyout's nested sections (issue #228).
// Only Admin-group subpages carry one; the "/admin" hub item itself doesn't.
export const ADMIN_SECTIONS = ["Review", "Roster", "Time", "Config"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export type NavDestination = {
  label: string;
  href: string;
  group: NavGroup;
  gate: NavGate;
  section?: AdminSection;
};

export type NavContext = { role: Role; kioskRegistered: boolean };

// Every nav destination, in display order. Mirrors src/components/SiteNav.tsx
// (Overview/Shop floor/Team groups + ADMIN_ITEMS) — the single source of
// truth both the sidebar and the command palette read from.
export const NAV_ITEMS: readonly NavDestination[] = [
  { label: "Home", href: "/", group: "Overview", gate: "guest" },
  { label: "Leaderboard", href: "/leaderboard", group: "Overview", gate: "guest" },

  { label: "Kiosk", href: "/kiosk", group: "Shop floor", gate: "kiosk" },
  { label: "Shop", href: "/shop", group: "Shop floor", gate: "student" },
  { label: "Batteries", href: "/batteries", group: "Shop floor", gate: "student" },
  { label: "Tools", href: "/tools", group: "Shop floor", gate: "student" },

  { label: "People", href: "/people", group: "Team", gate: "mentor" },
  { label: "Teams", href: "/teams", group: "Team", gate: "student" },
  { label: "Events", href: "/events", group: "Team", gate: "student" },
  { label: "Calendar", href: "/calendar", group: "Team", gate: "mentor" },
  { label: "Duplicates", href: "/admin/people/duplicates", group: "Team", gate: "admin" },
  { label: "Import CSV", href: "/admin/people/import", group: "Team", gate: "admin" },

  { label: "Admin", href: "/admin", group: "Admin", gate: "mentor" },
  // Review — mentor+
  {
    label: "Requests",
    href: "/admin/requests",
    group: "Admin",
    gate: "mentor",
    section: "Review",
  },
  {
    label: "Flagged sessions",
    href: "/admin/sessions/flagged",
    group: "Admin",
    gate: "mentor",
    section: "Review",
  },
  {
    label: "Absent members",
    href: "/admin/absent-members",
    group: "Admin",
    gate: "mentor",
    section: "Review",
  },
  { label: "Reports", href: "/admin/reports", group: "Admin", gate: "mentor", section: "Review" },
  // Roster — admin
  { label: "People", href: "/admin/people", group: "Admin", gate: "admin", section: "Roster" },
  { label: "Teams", href: "/admin/teams", group: "Admin", gate: "admin", section: "Roster" },
  { label: "Badges", href: "/admin/badges", group: "Admin", gate: "admin", section: "Roster" },
  {
    label: "Time import",
    href: "/admin/time-import",
    group: "Admin",
    gate: "admin",
    section: "Roster",
  },
  {
    label: "Application import",
    href: "/admin/application-import",
    group: "Admin",
    gate: "admin",
    section: "Roster",
  },
  // Time — mentor+ except where noted
  { label: "Meetings", href: "/admin/meetings", group: "Admin", gate: "admin", section: "Time" },
  {
    label: "Build days",
    href: "/admin/build-days",
    group: "Admin",
    gate: "mentor",
    section: "Time",
  },
  { label: "Sessions", href: "/admin/sessions", group: "Admin", gate: "mentor", section: "Time" },
  { label: "Events", href: "/admin/events", group: "Admin", gate: "mentor", section: "Time" },
  { label: "Forms", href: "/admin/forms", group: "Admin", gate: "mentor", section: "Time" },
  { label: "Parts", href: "/admin/projects", group: "Admin", gate: "mentor", section: "Time" },
  { label: "Periods", href: "/admin/periods", group: "Admin", gate: "admin", section: "Time" },
  // Config — admin
  {
    label: "Kiosk devices",
    href: "/admin/kiosk-devices",
    group: "Admin",
    gate: "admin",
    section: "Config",
  },
  {
    label: "Drive group sync",
    href: "/admin/drive-sync",
    group: "Admin",
    gate: "admin",
    section: "Config",
  },
  {
    label: "GitHub team sync",
    href: "/admin/github-sync",
    group: "Admin",
    gate: "admin",
    section: "Config",
  },
  {
    label: "FIRST roster status",
    href: "/admin/first-status",
    group: "Admin",
    gate: "admin",
    section: "Config",
  },
  { label: "Slack", href: "/admin/slack", group: "Admin", gate: "admin", section: "Config" },
  { label: "Settings", href: "/admin/settings", group: "Admin", gate: "admin", section: "Config" },
  { label: "Cron jobs", href: "/admin/cron", group: "Admin", gate: "admin", section: "Config" },
  { label: "Sync runs", href: "/admin/sync-runs", group: "Admin", gate: "admin", section: "Config" },
];

export function isAllowed(item: NavDestination, ctx: NavContext): boolean {
  if (item.gate === "kiosk") return hasRole(ctx.role, "mentor") || ctx.kioskRegistered;
  return hasRole(ctx.role, item.gate);
}

export function navDestinations(ctx: NavContext): NavDestination[] {
  return NAV_ITEMS.filter((item) => isAllowed(item, ctx));
}

// Admin subpages grouped into their nested-flyout sections (issue #228), in
// ADMIN_SECTIONS order, with empty sections dropped. Single source of truth
// for both the sidebar's FlySections and the rail's collapsed Admin flyout.
export function adminSections(
  ctx: NavContext,
): { label: AdminSection; items: NavDestination[] }[] {
  const dest = navDestinations(ctx);
  return ADMIN_SECTIONS.map((label) => ({
    label,
    items: dest.filter((d) => d.group === "Admin" && d.section === label),
  })).filter((s) => s.items.length > 0);
}

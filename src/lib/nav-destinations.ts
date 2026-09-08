import type { Role } from "./types";
import { hasRole } from "./authz";

export type NavGroup = "Overview" | "Shop floor" | "Team" | "Admin";

// A Role gate means hasRole(viewer, gate); "guest" is rank 0 so it's
// satisfied by every viewer, including an unauthenticated one — that's how a
// "public" item (Home, Leaderboard) is represented, no separate sentinel
// needed. "kiosk" is the one gate that isn't a plain role check: mentor+ OR a
// registered kiosk device (see NavContext.kioskRegistered).
export type NavGate = Role | "kiosk";

export type NavDestination = {
  label: string;
  href: string;
  group: NavGroup;
  gate: NavGate;
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
  { label: "Requests", href: "/admin/requests", group: "Admin", gate: "mentor" },
  { label: "Flagged sessions", href: "/admin/sessions/flagged", group: "Admin", gate: "mentor" },
  { label: "Reports", href: "/admin/reports", group: "Admin", gate: "mentor" },
  // Roster — admin
  { label: "People", href: "/admin/people", group: "Admin", gate: "admin" },
  { label: "Teams", href: "/admin/teams", group: "Admin", gate: "admin" },
  { label: "Badges", href: "/admin/badges", group: "Admin", gate: "admin" },
  { label: "Time import", href: "/admin/time-import", group: "Admin", gate: "admin" },
  {
    label: "Application import",
    href: "/admin/application-import",
    group: "Admin",
    gate: "admin",
  },
  // Time — mentor+ except where noted
  { label: "Meetings", href: "/admin/meetings", group: "Admin", gate: "admin" },
  { label: "Build days", href: "/admin/build-days", group: "Admin", gate: "mentor" },
  { label: "Sessions", href: "/admin/sessions", group: "Admin", gate: "mentor" },
  { label: "Events", href: "/admin/events", group: "Admin", gate: "mentor" },
  { label: "Forms", href: "/admin/forms", group: "Admin", gate: "mentor" },
  { label: "Parts", href: "/admin/projects", group: "Admin", gate: "mentor" },
  { label: "Periods", href: "/admin/periods", group: "Admin", gate: "admin" },
  // Config — admin
  { label: "Kiosk devices", href: "/admin/kiosk-devices", group: "Admin", gate: "admin" },
  { label: "Drive group sync", href: "/admin/drive-sync", group: "Admin", gate: "admin" },
  { label: "GitHub team sync", href: "/admin/github-sync", group: "Admin", gate: "admin" },
  { label: "FIRST roster status", href: "/admin/first-status", group: "Admin", gate: "admin" },
  { label: "Slack", href: "/admin/slack", group: "Admin", gate: "admin" },
  { label: "Settings", href: "/admin/settings", group: "Admin", gate: "admin" },
  { label: "Cron jobs", href: "/admin/cron", group: "Admin", gate: "admin" },
];

export function isAllowed(item: NavDestination, ctx: NavContext): boolean {
  if (item.gate === "kiosk") return hasRole(ctx.role, "mentor") || ctx.kioskRegistered;
  return hasRole(ctx.role, item.gate);
}

export function navDestinations(ctx: NavContext): NavDestination[] {
  return NAV_ITEMS.filter((item) => isAllowed(item, ctx));
}

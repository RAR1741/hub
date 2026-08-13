import type { PersonRow } from "./types";

export type OAuthLinkDecision = {
  action: "bootstrap-admin" | "adopt-admin" | "link" | "guest";
  personId?: string;
};

const OAUTH_LINKABLE_ROLES = new Set(["admin", "mentor"]);

export function decideOAuthLink(input: {
  matchedPerson: PersonRow | null;
  adminCount: number;
  linkedCount: number;
  firstAdmin: PersonRow | null;
}): OAuthLinkDecision {
  // No admins at all → the first-ever OAuth login provisions one.
  if (input.adminCount === 0) return { action: "bootstrap-admin" };
  // Fresh setup: admins already exist (e.g. the seeded admin) but nobody has
  // linked a Google account yet → adopt the first admin so initial setup can
  // get in. Guarded by linkedCount === 0 so this fires only once, before any
  // account is connected; afterwards it can never re-fire.
  if (input.linkedCount === 0 && input.firstAdmin) {
    return { action: "adopt-admin", personId: input.firstAdmin.id };
  }
  const p = input.matchedPerson;
  if (p && p.is_active && OAUTH_LINKABLE_ROLES.has(p.role)) {
    return { action: "link", personId: p.id };
  }
  return { action: "guest" };
}

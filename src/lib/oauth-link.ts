import type { PersonRow } from "./types";

export type OAuthLinkDecision = {
  action: "bootstrap-admin" | "link" | "guest";
  personId?: string;
};

const OAUTH_LINKABLE_ROLES = new Set(["admin", "mentor"]);

export function decideOAuthLink(input: {
  matchedPerson: PersonRow | null;
  adminCount: number;
}): OAuthLinkDecision {
  if (input.adminCount === 0) return { action: "bootstrap-admin" };
  const p = input.matchedPerson;
  if (p && p.is_active && OAUTH_LINKABLE_ROLES.has(p.role)) {
    return { action: "link", personId: p.id };
  }
  return { action: "guest" };
}

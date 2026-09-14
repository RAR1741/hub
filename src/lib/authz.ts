import { redirect } from "next/navigation";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

const RANK: Record<Role, number> = {
  guest: 0,
  student: 1,
  mentor: 2,
  admin: 3,
};

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export class ForbiddenError extends Error {
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireRole(actual: Role, required: Role): void {
  if (!hasRole(actual, required)) throw new ForbiddenError();
}

/**
 * Page-level role gate (server components only — it calls `redirect`).
 * A viewer who lacks `required` is sent away: anonymous visitors to /login,
 * where signing in actually helps, and anyone already signed in home — a
 * signed-in user bounced to the sign-in form just loops back to the denial.
 */
export function requirePageRole(viewer: Viewer, required: Role): void {
  if (hasRole(viewer.role, required)) return;
  redirect(viewer.person ? "/" : "/login");
}

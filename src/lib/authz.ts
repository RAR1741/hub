import type { Role } from "./types";

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

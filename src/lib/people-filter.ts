import type { Person } from "@/lib/types";

/** Only the fields the roster renders — keeps the server→client payload small. */
export type PeopleRow = Pick<
  Person,
  "id" | "firstName" | "lastName" | "email" | "role" | "isActive" | "studentIdNumber"
>;

export type RoleFilter = "all" | "student" | "mentor" | "admin";

// Order matters — this drives the segmented control's option order.
export const ROLE_OPTIONS: ReadonlyArray<[RoleFilter, string]> = [
  ["all", "All"],
  ["student", "Students"],
  ["mentor", "Mentors"],
  ["admin", "Admins"],
];

export function matchesSearch(p: PeopleRow, term: string): boolean {
  if (term === "") return true;
  const t = term.toLowerCase();
  return (
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(t) ||
    (p.email?.toLowerCase().includes(t) ?? false) ||
    (p.studentIdNumber?.toLowerCase().includes(t) ?? false)
  );
}

export function matchesRole(role: PeopleRow["role"], filter: RoleFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "student":
      return role === "student";
    case "mentor":
      // Inclusive: mentors AND admins, mirroring the leaderboard/column split.
      return role !== "student";
    case "admin":
      return role === "admin";
  }
}

export function filterPeople(
  people: PeopleRow[],
  opts: { search: string; role: RoleFilter; includeInactive: boolean },
): PeopleRow[] {
  return people.filter(
    (p) =>
      (opts.includeInactive || p.isActive) &&
      matchesRole(p.role, opts.role) &&
      matchesSearch(p, opts.search),
  );
}

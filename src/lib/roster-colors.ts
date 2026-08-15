// Single source of truth for the two roster role colors (student vs mentor).
//
// IMPORTANT: These hex values must stay in sync with the `--role-student` and
// `--role-mentor` CSS custom properties defined in `src/app/globals.css` (:root).
// Change them in both places together.
export const ROLE_COLORS = { student: "#4C9DF0", mentor: "#E0A020" } as const;

/**
 * CSS variable reference for a person's role color.
 * "Mentors" = any role that isn't "student" (mentors + admins), matching the
 * People-page split.
 */
export function roleColorVar(role: string): string {
  return role === "student" ? "var(--role-student)" : "var(--role-mentor)";
}

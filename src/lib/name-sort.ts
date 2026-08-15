/**
 * Central name sorting. Any list of people-shaped rows across the app should
 * order names through here, so the ordering rule lives in one place.
 *
 * First pass: locale-aware string sort on first name, then last name as the
 * tiebreaker. When we want something smarter later (last-name-first, natural
 * numeric handling, nickname awareness), change it here and every caller
 * follows.
 */

/** The minimal shape any sortable row must expose. */
export type Named = { firstName: string; lastName: string };

/** Comparator for `Array.prototype.sort`. PURE. */
export function compareByName(a: Named, b: Named): number {
  return (
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" }) ||
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" })
  );
}

/** Return a new array of rows sorted by name; does not mutate the input. PURE. */
export function sortByName<T extends Named>(rows: readonly T[]): T[] {
  return [...rows].sort(compareByName);
}

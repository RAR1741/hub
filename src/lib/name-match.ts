/** Case/space-normalized full string. PURE. */
export function normalizeFull(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Canonical name key: `first|last`, lowercased and trimmed. MUST match the
 * `person_name_alias.name_key` generated column
 * (`lower(btrim(first))||'|'||lower(btrim(last))`) so JS lookups line up with
 * stored aliases. PURE.
 */
export function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
}

/** True if one trimmed/lowercased string is a non-empty prefix of the other. PURE. */
export function isPrefixMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** Levenshtein edit distance between two strings. PURE. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Similarity of two full names in [0, 1]: 1 - normalizedLevenshtein of the
 * normalized `"first last"` strings. PURE.
 */
export function nameSimilarity(
  aFirst: string,
  aLast: string,
  bFirst: string,
  bLast: string,
): number {
  const a = normalizeFull(`${aFirst} ${aLast}`);
  const b = normalizeFull(`${bFirst} ${bLast}`);
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

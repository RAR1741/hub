import { nameSimilarity, isPrefixMatch, normalizeFull } from "./name-match";

/** Minimal person shape needed for duplicate detection. PURE. */
export type DupPerson = {
  id: string;
  first_name: string;
  last_name: string;
};

/**
 * A candidate duplicate pair. `a` and `b` are person ids, ordered so `a` is
 * always the lexicographically-smaller string (JS `<` comparison) and `b`
 * the larger — a stable, deterministic rule independent of input order.
 */
export type DupCandidate = {
  a: string;
  b: string;
  score: number;
};

const DEFAULT_THRESHOLD = 0.72;
const HEURISTIC_SCORE = 0.85;

/**
 * Finds likely-duplicate person pairs by name similarity. PURE — no DB.
 *
 * For every pair (i < j), a candidate is included when either:
 *  - `nameSimilarity(...) >= threshold` (default 0.72), or
 *  - the normalized last names are exactly equal AND the first names are a
 *    prefix match (e.g. "Nat" / "Nathaniel"), in which case the pair scores
 *    at least 0.85 regardless of raw similarity.
 *
 * The resulting score is `Math.max(similarity, heuristicHit ? 0.85 : 0)`.
 * Results are sorted by score descending, then by (a, b) id ascending for
 * stable, deterministic output.
 */
export function findDuplicateCandidates(
  people: DupPerson[],
  opts?: { threshold?: number },
): DupCandidate[] {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const candidates: DupCandidate[] = [];

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p1 = people[i];
      const p2 = people[j];

      const similarity = nameSimilarity(
        p1.first_name,
        p1.last_name,
        p2.first_name,
        p2.last_name,
      );

      const sameLastName =
        normalizeFull(p1.last_name) === normalizeFull(p2.last_name);
      const heuristicHit =
        sameLastName && isPrefixMatch(p1.first_name, p2.first_name);

      if (similarity < threshold && !heuristicHit) continue;

      const score = Math.max(similarity, heuristicHit ? HEURISTIC_SCORE : 0);
      const [a, b] = p1.id < p2.id ? [p1.id, p2.id] : [p2.id, p1.id];
      candidates.push({ a, b, score });
    }
  }

  candidates.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.a !== y.a) return x.a < y.a ? -1 : 1;
    return x.b < y.b ? -1 : x.b > y.b ? 1 : 0;
  });

  return candidates;
}

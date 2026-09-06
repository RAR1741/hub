export type TeamLink = { id: string; parentTeamId: string | null };

/** Ids of every ancestor of `teamId`, nearest first. Excludes `teamId`. PURE, cycle-safe. */
export function ancestorIds(teams: TeamLink[], teamId: string): string[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const visited = new Set<string>([teamId]);
  const result: string[] = [];
  let current = byId.get(teamId);
  while (current?.parentTeamId != null) {
    const parentId = current.parentTeamId;
    const parent = byId.get(parentId);
    if (!parent || visited.has(parentId)) break;
    visited.add(parentId);
    result.push(parentId);
    current = parent;
  }
  return result;
}

/** `teamId` plus every descendant, in BFS order. PURE, cycle-safe. */
export function subtreeIds(teams: TeamLink[], teamId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const t of teams) {
    if (t.parentTeamId == null) continue;
    const siblings = childrenOf.get(t.parentTeamId) ?? [];
    siblings.push(t.id);
    childrenOf.set(t.parentTeamId, siblings);
  }

  const visited = new Set<string>([teamId]);
  const result: string[] = [teamId];
  const queue: string[] = [teamId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const childId of childrenOf.get(next) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      result.push(childId);
      queue.push(childId);
    }
  }
  return result;
}

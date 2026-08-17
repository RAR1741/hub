import type { SupabaseClient } from "@supabase/supabase-js";
import { findDuplicateCandidates } from "./duplicate-people";
import type { PersonRow, TeamRow } from "./types";

export type PersonCard = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  emails: string[];
  sessionCount: number;
  teams: string[];
};

export type CandidatePair = {
  score: number;
  a: PersonCard;
  b: PersonCard;
};

export type RejectedPair = {
  a: PersonCard;
  b: PersonCard;
};

const MAX_PAIRS = 100;

async function client(db?: SupabaseClient): Promise<SupabaseClient> {
  return db ?? (await import("./db")).getDb();
}

/**
 * Load duplicate-candidate pairs, ranked by score, enriched with the data an
 * admin needs to decide which side to keep: sign-in emails, session (checked
 * in/out) count, and team names. Capped at the top 100 pairs to bound
 * enrichment cost; a per-person query loop across the (small) set of ids that
 * appear in those pairs is acceptable, but the identity/session/team lookups
 * themselves are each done in one batched query over all those ids rather
 * than one query per person.
 */
export async function listDuplicateCandidates(
  db?: SupabaseClient,
): Promise<CandidatePair[]> {
  const c = await client(db);

  const { data: peopleData } = await c
    .from("person")
    .select("id, first_name, last_name, role, is_active")
    .order("last_name");
  const people = (peopleData ?? []) as PersonRow[];

  const allCandidates = findDuplicateCandidates(
    people.map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name })),
  );

  // Load dismissed pairs and filter before capping and enriching.
  const { data: rejData } = await c
    .from("person_merge_rejection")
    .select("a, b");
  const dismissed = new Set<string>(
    ((rejData ?? []) as { a: string; b: string }[]).map((r) => `${r.a}|${r.b}`),
  );
  const candidates = allCandidates
    .filter((cand) => !dismissed.has(`${cand.a}|${cand.b}`))
    .slice(0, MAX_PAIRS);

  const byId = new Map(people.map((p) => [p.id, p]));
  const ids = Array.from(
    new Set(candidates.flatMap((cand) => [cand.a, cand.b])),
  );

  const [emailsById, sessionCountById, teamsById] = await Promise.all([
    loadEmailsByPerson(c, ids),
    loadSessionCountsByPerson(c, ids),
    loadTeamsByPerson(c, ids),
  ]);

  function toCard(id: string): PersonCard {
    const row = byId.get(id);
    return {
      id,
      firstName: row?.first_name ?? "",
      lastName: row?.last_name ?? "",
      role: row?.role ?? "",
      isActive: row?.is_active ?? false,
      emails: emailsById.get(id) ?? [],
      sessionCount: sessionCountById.get(id) ?? 0,
      teams: teamsById.get(id) ?? [],
    };
  }

  return candidates.map((cand) => ({
    score: cand.score,
    a: toCard(cand.a),
    b: toCard(cand.b),
  }));
}

async function loadEmailsByPerson(
  c: SupabaseClient,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const { data } = await c
    .from("person_identity")
    .select("person_id, email, is_primary")
    .in("person_id", ids)
    .order("is_primary", { ascending: false });
  for (const row of (data ?? []) as { person_id: string; email: string }[]) {
    const list = map.get(row.person_id) ?? [];
    list.push(row.email);
    map.set(row.person_id, list);
  }
  return map;
}

async function loadSessionCountsByPerson(
  c: SupabaseClient,
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await c
    .from("session")
    .select("person_id")
    .in("person_id", ids);
  for (const row of (data ?? []) as { person_id: string }[]) {
    map.set(row.person_id, (map.get(row.person_id) ?? 0) + 1);
  }
  return map;
}

async function loadTeamsByPerson(
  c: SupabaseClient,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const { data } = await c
    .from("team_membership")
    .select("person_id, team (name)")
    .in("person_id", ids);
  for (const row of (data ?? []) as unknown as {
    person_id: string;
    team: Pick<TeamRow, "name"> | null;
  }[]) {
    if (!row.team) continue;
    const list = map.get(row.person_id) ?? [];
    list.push(row.team.name);
    map.set(row.person_id, list);
  }
  return map;
}

const SELF_MERGE = "P0001";
const NOT_FOUND = "P0002";

/**
 * Merge `loserId`'s data into `winnerId` via the `merge_person` DB function.
 * Rejects a self-merge before touching the DB (400, no rpc call). Maps the
 * function's raised errors: P0001 (self-merge, defense in depth) -> 400,
 * P0002 (person not found) -> 404, anything else -> 500.
 */
export async function mergePeople(
  winnerId: string,
  loserId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  if (winnerId === loserId) return { ok: false, status: 400 };
  const c = await client(db);
  const { error } = await c.rpc("merge_person", {
    p_winner: winnerId,
    p_loser: loserId,
  });
  if (error) {
    if (error.code === SELF_MERGE) return { ok: false, status: 400 };
    if (error.code === NOT_FOUND) return { ok: false, status: 404 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

/** Normalise two person ids into (a, b) order matching DupCandidate. */
function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Dismiss a duplicate-candidate pair so it is permanently filtered from
 * listDuplicateCandidates. Idempotent (upsert). Returns 400 for self-pair,
 * 500 on DB error, 200 on success.
 */
export async function rejectPair(
  aId: string,
  bId: string,
  rejectedBy: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  if (aId === bId) return { ok: false, status: 400 };
  const [a, b] = orderedPair(aId, bId);
  const c = await client(db);
  const { error } = await c
    .from("person_merge_rejection")
    .upsert({ a, b, rejected_by: rejectedBy }, { onConflict: "a,b" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/**
 * Undo a dismissed pair. Idempotent — deleting a non-existent row is a no-op.
 * Returns 500 on DB error, 200 otherwise.
 */
export async function unrejectPair(
  aId: string,
  bId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const [a, b] = orderedPair(aId, bId);
  const c = await client(db);
  const { error } = await c
    .from("person_merge_rejection")
    .delete()
    .eq("a", a)
    .eq("b", b);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/**
 * Load all dismissed pairs with both people's cards for the undo surface.
 * Returns an empty array if there are none.
 */
export async function listRejectedPairs(
  db?: SupabaseClient,
): Promise<RejectedPair[]> {
  const c = await client(db);

  const { data: rejData } = await c
    .from("person_merge_rejection")
    .select("a, b")
    .order("created_at", { ascending: false });
  const rejected = (rejData ?? []) as { a: string; b: string }[];
  if (rejected.length === 0) return [];

  const ids = Array.from(new Set(rejected.flatMap((r) => [r.a, r.b])));

  const { data: peopleData } = await c
    .from("person")
    .select("id, first_name, last_name, role, is_active")
    .in("id", ids);
  const people = (peopleData ?? []) as PersonRow[];
  const byId = new Map(people.map((p) => [p.id, p]));

  const [emailsById, sessionCountById, teamsById] = await Promise.all([
    loadEmailsByPerson(c, ids),
    loadSessionCountsByPerson(c, ids),
    loadTeamsByPerson(c, ids),
  ]);

  function toCard(id: string): PersonCard {
    const row = byId.get(id);
    return {
      id,
      firstName: row?.first_name ?? "",
      lastName: row?.last_name ?? "",
      role: row?.role ?? "",
      isActive: row?.is_active ?? false,
      emails: emailsById.get(id) ?? [],
      sessionCount: sessionCountById.get(id) ?? 0,
      teams: teamsById.get(id) ?? [],
    };
  }

  return rejected.map((r) => ({ a: toCard(r.a), b: toCard(r.b) }));
}

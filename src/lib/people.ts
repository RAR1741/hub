import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole } from "./authz";
import type { Person, PersonRow, Role, Team, TeamRow } from "./types";
import { personFromRow, teamFromRow } from "./types";
import type { Viewer } from "./viewer";

export function displayName(p: {
  first_name: string;
  last_name: string;
  display_name: string | null;
}): string {
  return p.display_name ?? `${p.first_name} ${p.last_name}`;
}

export type RosterView =
  | { kind: "names"; names: string[] }
  | { kind: "full"; people: Person[] };

/** Role-scoped roster projection (spec §8 answer 2). PURE. */
export function rosterView(role: Role, rows: PersonRow[]): RosterView {
  const active = rows.filter((r) => r.is_active);
  if (hasRole(role, "mentor")) {
    const people = [...active]
      .sort((a, b) => a.last_name.localeCompare(b.last_name))
      .map(personFromRow);
    return { kind: "full", people };
  }
  const names = active.map(displayName).sort((a, b) => a.localeCompare(b));
  return { kind: "names", names };
}

/** Self or mentor+. PURE. */
export function canViewProfile(viewer: Viewer, personId: string): boolean {
  if (viewer.person?.id === personId) return true;
  return hasRole(viewer.role, "mentor");
}

export async function listPeople(
  q?: string,
  db?: SupabaseClient,
): Promise<PersonRow[]> {
  const client = db ?? (await import("./db")).getDb();
  let query = client.from("person").select("*").order("last_name");
  if (q && q.trim()) {
    const term = q.trim().replaceAll("%", "").replaceAll(",", "");
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,display_name.ilike.%${term}%`,
    );
  }
  const { data } = await query;
  return (data ?? []) as PersonRow[];
}

export async function getPersonWithTeams(
  id: string,
  db?: SupabaseClient,
): Promise<{ person: Person; teams: { team: Team; isManager: boolean }[] } | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data: personRow } = await client
    .from("person")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!personRow) return null;

  const { data: memberships } = await client
    .from("team_membership")
    .select("is_manager, team (*)")
    .eq("person_id", id);

  const teams = (memberships ?? [])
    .filter((m) => m.team)
    .map((m) => ({
      team: teamFromRow(m.team as unknown as TeamRow),
      isManager: m.is_manager as boolean,
    }));

  return { person: personFromRow(personRow as PersonRow), teams };
}

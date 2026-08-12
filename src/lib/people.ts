import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole } from "./authz";
import type { Person, PersonRow, Role, Team, TeamRow } from "./types";
import { personFromRow, teamFromRow } from "./types";
import { optInt, optString, reqString } from "./validate";
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
    // PostgREST treats a double-quoted filter value as a literal, so wrapping
    // the term in `"..."` prevents it from injecting `.or()` grouping syntax
    // (parentheses, commas, operators). Strip `"` and `\` first so the term
    // itself can't escape out of the quoting.
    const term = q.trim().replaceAll('"', "").replaceAll("\\", "");
    query = query.or(
      `first_name.ilike."%${term}%",last_name.ilike."%${term}%",display_name.ilike."%${term}%"`,
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

const ASSIGNABLE_ROLES = ["admin", "mentor", "captain", "student"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type PersonInput = {
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: AssignableRole;
  gradYear: number | null;
  email: string | null;
  phone: string | null;
  shirtSize: string | null;
  dietaryRestrictions: string | null;
  bio: string | null;
  studentIdNumber: string | null;
  isActive: boolean;
};

/** Validate + normalize an admin person payload. PURE. Null = invalid. */
export function parsePersonInput(body: unknown): PersonInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const firstName = reqString(b.firstName, 80);
  const lastName = reqString(b.lastName, 80);
  const displayName = optString(b.displayName, 80);
  const gradYear = optInt(b.gradYear, 2000, 2100);
  const email = optString(b.email, 254);
  const phone = optString(b.phone, 32);
  const shirtSize = optString(b.shirtSize, 16);
  const dietaryRestrictions = optString(b.dietaryRestrictions, 500);
  const bio = optString(b.bio, 2000);
  const studentIdNumber = optString(b.studentIdNumber, 64);
  const role = ASSIGNABLE_ROLES.find((r) => r === b.role);
  const isActive = typeof b.isActive === "boolean" ? b.isActive : null;

  if (
    !firstName || !lastName || !displayName || !gradYear || !email ||
    !phone || !shirtSize || !dietaryRestrictions || !bio ||
    !studentIdNumber || !role || isActive === null
  ) {
    return null;
  }

  return {
    firstName,
    lastName,
    displayName: displayName.value,
    role,
    gradYear: gradYear.value,
    // person.email is the OAuth allowlist key — always store lowercased.
    email: email.value?.toLowerCase() ?? null,
    phone: phone.value,
    shirtSize: shirtSize.value,
    dietaryRestrictions: dietaryRestrictions.value,
    bio: bio.value,
    studentIdNumber: studentIdNumber.value,
    isActive,
  };
}

export function personRowFromInput(input: PersonInput): Record<string, unknown> {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    display_name: input.displayName,
    role: input.role,
    grad_year: input.gradYear,
    email: input.email,
    phone: input.phone,
    shirt_size: input.shirtSize,
    dietary_restrictions: input.dietaryRestrictions,
    bio: input.bio,
    student_id_number: input.studentIdNumber,
    is_active: input.isActive,
  };
}

const UNIQUE_VIOLATION = "23505";

export async function createPerson(
  input: PersonInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("person")
    .insert(personRowFromInput(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  return { ok: true, id: data.id as string };
}

const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Hard-delete a person. `session.person_id` and `team_membership.person_id`
 * are `on delete cascade` (see 20260811060855_attendance.sql /
 * 20260811032027_roster_teams.sql), so a person's own attendance history and
 * team memberships are removed along with them. Other tables that reference a
 * person as staff — `session.edited_by`, `excusal.created_by`,
 * `membership_application.reviewed_by`, `account_request.reviewed_by`,
 * `kiosk_device.created_by` — have no delete action (default RESTRICT), so
 * deleting a mentor/admin who edited/reviewed/created those rows is blocked
 * with a foreign-key-violation surfaced as 409.
 */
export async function deletePerson(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("person")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 409 : 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function updatePerson(
  id: string,
  input: PersonInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("person")
    .update(personRowFromInput(input))
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

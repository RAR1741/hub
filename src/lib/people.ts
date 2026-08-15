import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole } from "./authz";
import type { Person, PersonRow, Role, Team, TeamRow } from "./types";
import { personFromRow, teamFromRow } from "./types";
import { optInt, optString, reqString } from "./validate";
import type { Viewer } from "./viewer";

/**
 * The name to show for a person. Deliberately ignores `display_name` for now:
 * the application import populated it with self-entered nicknames, much of it
 * junk, so every surface except the admin person-edit form shows the real
 * legal name instead. `display_name` is still stored and editable there; flip
 * this back to `p.display_name ?? …` to re-enable it everywhere.
 */
export function displayName(p: {
  first_name: string;
  last_name: string;
  display_name?: string | null;
}): string {
  return `${p.first_name} ${p.last_name}`;
}

/**
 * First name + last initial, e.g. "Ada L." — the only form a guest may see on
 * any non-Kiosk page. Ignores display_name/nicknames on purpose (masking works
 * off the real name). Falls back to just the first name when there's no last.
 * PURE.
 */
export function publicName(p: { first_name: string; last_name: string }): string {
  const initial = p.last_name.trim().charAt(0);
  return initial ? `${p.first_name} ${initial}.` : p.first_name;
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

export const ASSIGNABLE_ROLES = ["admin", "mentor", "student"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

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
  // Application-derived fields. Optional so callers that build a PersonInput
  // from a narrower source (roster CSV, account-request approval) needn't
  // supply them; the admin person form always sets them via parsePersonInput.
  dateOfBirth?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  zip?: string | null;
  homePhone?: string | null;
  school?: string | null;
  ethnicity?: string | null;
  race?: string | null;
  interests?: string[] | null;
};

/**
 * Normalize an optional `interests` payload into a clean string[] (or null).
 * Accepts an array of strings or a comma-separated string; trims, drops blanks,
 * and returns null when nothing survives so a blank input clears the column.
 * The outer-null-means-invalid convention matches optString.
 */
function optStringArray(v: unknown): { value: string[] | null } | null {
  if (v === undefined || v === null) return { value: null };
  let parts: string[];
  if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === "string")) return null;
    parts = v as string[];
  } else if (typeof v === "string") {
    parts = v.split(",");
  } else {
    return null;
  }
  const cleaned = parts.map((s) => s.trim()).filter((s) => s.length > 0);
  return { value: cleaned.length ? cleaned : null };
}

/** ISO calendar date (YYYY-MM-DD). Same outer-null convention as optString. */
function optDate(v: unknown): { value: string | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return { value: null };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject formatting-valid but non-existent dates (e.g. 2004-13-40) by
  // round-tripping through Date and requiring the components to survive.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { value: s };
}

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
  const dateOfBirth = optDate(b.dateOfBirth);
  const streetAddress = optString(b.streetAddress, 200);
  const city = optString(b.city, 100);
  const zip = optString(b.zip, 20);
  const homePhone = optString(b.homePhone, 32);
  const school = optString(b.school, 200);
  const ethnicity = optString(b.ethnicity, 200);
  const race = optString(b.race, 200);
  const interests = optStringArray(b.interests);

  if (
    !firstName || !lastName || !displayName || !gradYear || !email ||
    !phone || !shirtSize || !dietaryRestrictions || !bio ||
    !studentIdNumber || !role || isActive === null ||
    !dateOfBirth || !streetAddress || !city || !zip || !homePhone ||
    !school || !ethnicity || !race || !interests
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
    dateOfBirth: dateOfBirth.value,
    streetAddress: streetAddress.value,
    city: city.value,
    zip: zip.value,
    homePhone: homePhone.value,
    school: school.value,
    ethnicity: ethnicity.value,
    race: race.value,
    interests: interests.value,
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
    date_of_birth: input.dateOfBirth ?? null,
    street_address: input.streetAddress ?? null,
    city: input.city ?? null,
    zip: input.zip ?? null,
    home_phone: input.homePhone ?? null,
    school: input.school ?? null,
    ethnicity: input.ethnicity ?? null,
    race: input.race ?? null,
    interests: input.interests ?? null,
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

/**
 * The subset of person columns a roster CSV row can supply. `firstName` /
 * `lastName` are always applied (the CSV parser requires them on every row).
 * `email` / `role` / `gradYear` / `studentIdNumber` are `null` when the CSV
 * left that column blank for this row — and on UPDATE, null means "leave the
 * existing value alone", not "clear it". (There's currently no way to
 * deliberately blank out someone's email/grad-year/student-ID via CSV; that
 * felt like a safer default than a blank cell silently wiping data — e.g.
 * blanking `email` would drop someone off the OAuth allowlist.) `role: null`
 * additionally covers "this row didn't specify a role" (the parser defaults
 * a blank role to `student` for CREATE, but that default must never demote
 * an existing mentor/admin back to student on re-import).
 */
export type RosterFieldsInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  role: AssignableRole | null;
  gradYear: number | null;
  studentIdNumber: string | null;
};

/**
 * Update ONLY the roster-CSV-supplied columns on a matched person, leaving
 * every other column (display_name, phone, shirt_size, dietary_restrictions,
 * bio, is_active) untouched. Deliberately distinct from `updatePerson`, which
 * overwrites the full row — a CSV import only carries a subset of fields, and
 * doing a full overwrite from that subset would null out data the roster
 * template doesn't collect (e.g. someone's phone number or bio) on every
 * re-import. Blank/unspecified CSV cells (see `RosterFieldsInput`) are
 * likewise left out of the update patch rather than clearing the column.
 */
export async function updatePersonRosterFields(
  id: string,
  input: RosterFieldsInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const patch: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
  };
  if (input.email !== null) patch.email = input.email;
  if (input.role !== null) patch.role = input.role;
  if (input.gradYear !== null) patch.grad_year = input.gradYear;
  if (input.studentIdNumber !== null) patch.student_id_number = input.studentIdNumber;

  const { data, error } = await client
    .from("person")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/**
 * Find an existing person by email (exact match — person.email is always
 * stored lowercased, and CSV rows are lowercased at parse time) or, failing
 * that, by student_id_number. Uses `.eq()` (parameterized) rather than a
 * `.or()` filter string so free-text student IDs from an uploaded CSV can
 * never influence PostgREST filter syntax.
 */
export async function findPersonForRosterRow(
  row: { email: string | null; studentIdNumber: string | null },
  db?: SupabaseClient,
): Promise<string | null> {
  const client = db ?? (await import("./db")).getDb();
  if (row.email) {
    const { data } = await client
      .from("person")
      .select("id")
      .eq("email", row.email)
      .maybeSingle();
    if (data) return data.id as string;
  }
  if (row.studentIdNumber) {
    const { data } = await client
      .from("person")
      .select("id")
      .eq("student_id_number", row.studentIdNumber)
      .maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

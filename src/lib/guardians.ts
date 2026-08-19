import type { SupabaseClient } from "@supabase/supabase-js";
import type { Guardian, GuardianRow } from "./types";
import { guardianFromRow } from "./types";
import { optString, reqString } from "./validate";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

async function client(db?: SupabaseClient): Promise<SupabaseClient> {
  return db ?? (await import("./db")).getDb();
}

export type GuardianInput = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
};

/** Validate + normalize an admin guardian payload. PURE. Null = invalid. */
export function parseGuardianInput(body: unknown): GuardianInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const firstName = reqString(b.firstName, 80);
  const lastName = reqString(b.lastName, 80);
  // Guardians aren't login identities, so their email is left as typed
  // (no lowercasing) unlike person.email.
  const email = optString(b.email, 254);
  const phone = optString(b.phone, 32);
  const employer = optString(b.employer, 200);

  if (!firstName || !lastName || !email || !phone || !employer) {
    return null;
  }

  return {
    firstName,
    lastName,
    email: email.value,
    phone: phone.value,
    employer: employer.value,
  };
}

/**
 * Relationship (e.g. "Mother", "Guardian") is passed alongside guardian
 * fields on create/link but lives on the `person_guardian` join row, not the
 * `guardian` row — validated separately from the rest of the guardian input.
 */
export function parseRelationship(v: unknown): { value: string | null } | null {
  return optString(v, 100);
}

export function guardianRowFromInput(input: GuardianInput): Record<string, unknown> {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    employer: input.employer,
  };
}

export async function getGuardiansForPerson(
  personId: string,
  db?: SupabaseClient,
): Promise<{ guardian: Guardian; relationship: string | null }[]> {
  const c = await client(db);
  const { data } = await c
    .from("person_guardian")
    .select("relationship, guardian(*)")
    .eq("person_id", personId);
  const rows = (data ?? []) as { relationship: string | null; guardian: GuardianRow }[];
  return rows
    .map((row) => ({
      guardian: guardianFromRow(row.guardian),
      relationship: row.relationship,
    }))
    .sort((a, b) => {
      const lastCmp = a.guardian.lastName.localeCompare(b.guardian.lastName);
      if (lastCmp !== 0) return lastCmp;
      return a.guardian.firstName.localeCompare(b.guardian.firstName);
    });
}

/**
 * Create a new guardian and link them to a person in one step. A foreign-key
 * violation on the link insert means `personId` doesn't exist (404); any
 * other failure on either insert is a 500.
 */
export async function createGuardianForPerson(
  personId: string,
  input: GuardianInput,
  relationship: string | null,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const c = await client(db);
  const { data, error } = await c
    .from("guardian")
    .insert(guardianRowFromInput(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, status: 500 };
  }
  const guardianId = data.id as string;

  const { error: linkError } = await c.from("person_guardian").insert({
    person_id: personId,
    guardian_id: guardianId,
    relationship,
  });
  if (linkError) {
    return { ok: false, status: linkError.code === FOREIGN_KEY_VIOLATION ? 404 : 500 };
  }
  return { ok: true, id: guardianId };
}

/** Link (or re-link with an updated relationship) an existing guardian to a person. */
export async function linkGuardian(
  personId: string,
  guardianId: string,
  relationship: string | null,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { error } = await c.from("person_guardian").upsert(
    { person_id: personId, guardian_id: guardianId, relationship },
    { onConflict: "person_id,guardian_id" },
  );
  if (error) {
    return { ok: false, status: error.code === FOREIGN_KEY_VIOLATION ? 404 : 500 };
  }
  return { ok: true, status: 200 };
}

/** Unlink a guardian from a person. Does NOT delete the guardian record itself. */
export async function unlinkGuardian(
  personId: string,
  guardianId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { data, error } = await c
    .from("person_guardian")
    .delete()
    .eq("person_id", personId)
    .eq("guardian_id", guardianId)
    .select("person_id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function updateGuardian(
  guardianId: string,
  input: GuardianInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { data, error } = await c
    .from("guardian")
    .update({ ...guardianRowFromInput(input), updated_at: new Date().toISOString() })
    .eq("id", guardianId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Hard-delete a guardian. `person_guardian` rows cascade via FK. */
export async function deleteGuardian(
  guardianId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { data, error } = await c
    .from("guardian")
    .delete()
    .eq("id", guardianId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function searchGuardians(q: string, db?: SupabaseClient): Promise<Guardian[]> {
  const term = q.trim();
  if (!term) return [];
  const c = await client(db);
  const { data } = await c
    .from("guardian")
    .select("*")
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
    .order("last_name")
    .limit(10);
  return ((data ?? []) as GuardianRow[]).map(guardianFromRow);
}

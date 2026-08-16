import type { SupabaseClient } from "@supabase/supabase-js";

export type PersonIdentityRow = {
  id: string;
  person_id: string;
  email: string;
  auth_user_id: string | null;
  is_primary: boolean;
  provider: string;
  created_at: string;
};

const UNIQUE_VIOLATION = "23505";

async function client(db?: SupabaseClient): Promise<SupabaseClient> {
  return db ?? (await import("./db")).getDb();
}

export async function listPersonIdentities(
  personId: string,
  db?: SupabaseClient,
): Promise<PersonIdentityRow[]> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("person_id", personId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  return (data ?? []) as PersonIdentityRow[];
}

/**
 * Add a sign-in email to a person. Their FIRST email is written through
 * person.email (the primary control knob — the DB trigger creates the
 * primary identity); any further email inserts a secondary identity row.
 * 400 blank/malformed, 404 unknown person, 409 email owned by someone else.
 */
export async function addPersonEmail(
  personId: string,
  email: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return { ok: false, status: 400 };
  const c = await client(db);

  const { data: person } = await c
    .from("person")
    .select("id, email")
    .eq("id", personId)
    .maybeSingle();
  if (!person) return { ok: false, status: 404 };

  if (!(person as { email: string | null }).email) {
    const { error } = await c
      .from("person")
      .update({ email: normalized })
      .eq("id", personId);
    if (error) {
      return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
    }
    return { ok: true, status: 200 };
  }

  const { error } = await c.from("person_identity").insert({
    person_id: personId,
    email: normalized,
    is_primary: false,
  });
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  return { ok: true, status: 200 };
}

/**
 * Remove a sign-in email. Removing an identity with a linked Google login
 * unlinks that account (admin-only by design). The primary can only be
 * removed when it's the person's sole identity — then it goes through
 * person.email = null so the mirror trigger stays authoritative.
 */
export async function removePersonIdentity(
  personId: string,
  identityId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number; reason?: "primary_with_secondaries" }> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("id", identityId)
    .eq("person_id", personId)
    .maybeSingle();
  const identity = data as PersonIdentityRow | null;
  if (!identity) return { ok: false, status: 404 };

  if (identity.is_primary) {
    const { count } = await c
      .from("person_identity")
      .select("id", { count: "exact", head: true })
      .eq("person_id", personId)
      .eq("is_primary", false);
    if ((count ?? 0) > 0) {
      return { ok: false, status: 409, reason: "primary_with_secondaries" };
    }
    const { error } = await c
      .from("person")
      .update({ email: null })
      .eq("id", personId);
    if (error) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  }

  const { error } = await c
    .from("person_identity")
    .delete()
    .eq("id", identityId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/** Promote an identity to primary by pointing person.email at it. */
export async function makePrimaryIdentity(
  personId: string,
  identityId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const c = await client(db);
  const { data } = await c
    .from("person_identity")
    .select("*")
    .eq("id", identityId)
    .eq("person_id", personId)
    .maybeSingle();
  const identity = data as PersonIdentityRow | null;
  if (!identity) return { ok: false, status: 404 };
  if (identity.is_primary) return { ok: true, status: 200 };

  const { error } = await c
    .from("person")
    .update({ email: identity.email })
    .eq("id", personId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

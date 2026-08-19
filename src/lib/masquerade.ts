import type { SupabaseClient } from "@supabase/supabase-js";


export const MASQUERADE_COOKIE = "hub_masquerade_session";

/**
 * Active masquerade session: the admin's real person ID and the session ID
 * (opaque reference to look up the session row in the DB to verify it's still
 * active and hasn't been revoked).
 */
export type MasqueradeSession = {
  adminPersonId: string;
  sessionId: string;
};

/**
 * Start a masquerade session: admin views the app as target (non-admin role).
 * Returns the session ID to store in the cookie, or an error status.
 *
 * Fails with:
 * - 404 if target person not found
 * - 409 if target is inactive or is an admin (can't masquerade as admin)
 * - 500 on other DB errors
 */
export async function startMasquerade(
  adminPersonId: string,
  targetPersonId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; sessionId: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();

  // Look up target: verify exists, is_active, and is NOT admin.
  const { data: targetRow, error: targetError } = await client
    .from("person")
    .select("id, role, is_active")
    .eq("id", targetPersonId)
    .maybeSingle();

  if (targetError) {
    // DB error — return 500 for debugging/monitoring
    console.error("[masquerade] target lookup error:", targetError);
    return { ok: false, status: 500 };
  }

  if (!targetRow) {
    // Not found
    return { ok: false, status: 404 };
  }

  if (!targetRow.is_active || targetRow.role === "admin") {
    // Target is inactive or admin — cannot masquerade
    return { ok: false, status: 409 };
  }

  // Auto-end any existing active session for this admin (stale/retried case).
  await client
    .from("masquerade_session")
    .update({ ended_at: new Date().toISOString() })
    .eq("admin_person_id", adminPersonId)
    .is("ended_at", null);

  // Insert new session, get back the ID.
  const { data: session, error: insertError } = await client
    .from("masquerade_session")
    .insert({
      admin_person_id: adminPersonId,
      target_person_id: targetPersonId,
    })
    .select("id")
    .single();

  if (insertError || !session) {
    console.error("[masquerade] insert error:", insertError);
    return { ok: false, status: 500 };
  }

  return { ok: true, sessionId: session.id as string };
}

/**
 * Find the active masquerade session for a given session ID, if it exists.
 * Verifies the session row exists and ended_at is null.
 * Returns the admin and target person IDs, or null if not found/expired.
 */
export async function findActiveMasquerade(
  sessionId: string,
  db?: SupabaseClient,
): Promise<{
  adminPersonId: string;
  targetPersonId: string;
} | null> {
  const client = db ?? (await import("./db")).getDb();

  const { data: session, error } = await client
    .from("masquerade_session")
    .select("admin_person_id, target_person_id, ended_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session) {
    return null;
  }

  // Session is only active if ended_at is null.
  if (session.ended_at !== null) {
    return null;
  }

  return {
    adminPersonId: session.admin_person_id as string,
    targetPersonId: session.target_person_id as string,
  };
}

/**
 * End a masquerade session by ID. Sets ended_at to now.
 * Returns success/not-found status.
 */
export async function endMasquerade(
  sessionId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();

  const { data, error } = await client
    .from("masquerade_session")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404 };
  }

  return { ok: true, status: 200 };
}

import { resolveServerSupabaseUrl } from "../../src/lib/supabase-url";

function restBaseUrl(): string {
  const url = resolveServerSupabaseUrl({
    SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  return `${url}/rest/v1`;
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set for E2E seeding");
  }
  return key;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = serviceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Upsert the kiosk_device row the kiosk E2E spec needs. Idempotent. */
export async function seedKioskDevice(tokenHash: string): Promise<void> {
  const res = await fetch(`${restBaseUrl()}/kiosk_device?on_conflict=token_hash`, {
    method: "POST",
    headers: authHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({ name: "E2E Tablet", token_hash: tokenHash }),
  });
  if (![200, 201, 409].includes(res.status)) {
    const body = await res.text().catch(() => "");
    throw new Error(`seedKioskDevice failed: ${res.status} ${body}`);
  }
}

/** The person id of the student row seeded by supabase/seed.sql (student_id_number = 1741). */
export async function seededStudentPersonId(): Promise<string> {
  const res = await fetch(
    `${restBaseUrl()}/person?student_id_number=eq.1741&select=id`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`seededStudentPersonId lookup failed: ${res.status} ${body}`);
  }
  const rows = (await res.json()) as { id: string }[];
  if (!rows[0]?.id) {
    throw new Error(
      "seededStudentPersonId: no person row with student_id_number=1741 — is the DB seeded?",
    );
  }
  return rows[0].id;
}

/** The id of a pending excusal_request row for a person+date, or null if none exists. */
export async function findPendingExcusalRequestId(
  personId: string,
  date: string,
): Promise<string | null> {
  const res = await fetch(
    `${restBaseUrl()}/excusal_request?person_id=eq.${personId}&date=eq.${date}&status=eq.pending&select=id&order=created_at.desc&limit=1`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`findPendingExcusalRequestId lookup failed: ${res.status} ${body}`);
  }
  const rows = (await res.json()) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** True if an excusal row exists for the given person+date. */
export async function excusalExists(personId: string, date: string): Promise<boolean> {
  const res = await fetch(
    `${restBaseUrl()}/excusal?person_id=eq.${personId}&date=eq.${date}&select=person_id`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`excusalExists lookup failed: ${res.status} ${body}`);
  }
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

/**
 * Delete any excusal_request rows for a person+date, regardless of status.
 * Used to make specs that POST /api/excusal-requests re-run-safe against the
 * partial-unique `one_pending_excusal_request_per_person_date` constraint —
 * without this, a 2nd run (without `db:reset`) hits a leftover pending row
 * from the prior run and gets a 409 instead of the 201 the spec asserts.
 */
export async function deleteExcusalRequests(personId: string, date: string): Promise<void> {
  const res = await fetch(
    `${restBaseUrl()}/excusal_request?person_id=eq.${personId}&date=eq.${date}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`deleteExcusalRequests failed: ${res.status} ${body}`);
  }
}

/**
 * Delete any person rows with the given first/last name (and, via FK cascade,
 * their person_guardian link rows). Note: guardian rows themselves have no FK
 * to person, so a guardian linked only to this person is intentionally left
 * behind (orphaned), not cascade-deleted. Used to make the application-import
 * E2E re-run-safe — without this, a 2nd run finds the person already
 * imported with an identical last_application_at and treats the row as
 * stale rather than newly created.
 */
export async function deletePersonByName(firstName: string, lastName: string): Promise<void> {
  const res = await fetch(
    `${restBaseUrl()}/person?first_name=eq.${encodeURIComponent(firstName)}&last_name=eq.${encodeURIComponent(lastName)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`deletePersonByName failed: ${res.status} ${body}`);
  }
}

/** Delete the excusal row for a person+date, if any. Idempotent. */
export async function deleteExcusal(personId: string, date: string): Promise<void> {
  const res = await fetch(
    `${restBaseUrl()}/excusal?person_id=eq.${personId}&date=eq.${date}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`deleteExcusal failed: ${res.status} ${body}`);
  }
}

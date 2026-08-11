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

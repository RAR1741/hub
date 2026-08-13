import type { SupabaseClient } from "@supabase/supabase-js";
import { createExcusal } from "./excusals";
import { displayName } from "./people";
import type { ExcusalRequest, ExcusalRequestRow } from "./types";
import { excusalRequestFromRow } from "./types";
import { optString } from "./validate";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExcusalRequestInput = { date: string; reason: string | null };

/** Validate a student's excusal-request payload. PURE. */
export function parseExcusalRequestInput(body: unknown): ExcusalRequestInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const date =
    typeof b.date === "string" && ISO_DATE.test(b.date) && !Number.isNaN(Date.parse(b.date))
      ? b.date
      : null;
  if (!date) return null;
  const reason = optString(b.reason, 500);
  if (!reason) return null;
  return { date, reason: reason.value };
}

/** Insert a pending excusal request for the given person. */
export async function createExcusalRequest(
  personId: string,
  input: ExcusalRequestInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("excusal_request").insert({
    person_id: personId,
    date: input.date,
    reason: input.reason,
    status: "pending",
  });
  if (error) {
    // Partial unique index one_pending_excusal_request_per_person_date.
    if (error.code === "23505") return { ok: false, status: 409 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

export type PendingExcusalRequest = ExcusalRequest & { name: string };

/**
 * Pending requests, newest first, with the requester's display name. Uses the
 * `person!person_id` FK-hint embed — excusal_request has two person FKs
 * (person_id + reviewed_by), so an unqualified embed is ambiguous and
 * PostgREST rejects it with PGRST201.
 */
export async function listPendingExcusalRequests(
  db?: SupabaseClient,
): Promise<PendingExcusalRequest[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("excusal_request")
    .select("*, person!person_id (id, first_name, last_name, display_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) console.error("listPendingExcusalRequests: query failed", error);
  return (data ?? [])
    .filter((r) => r.person)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      return {
        ...excusalRequestFromRow(r as unknown as ExcusalRequestRow),
        name: displayName(p),
      };
    });
}

/** A person's own excusal requests, newest first. */
export async function listExcusalRequestsForPerson(
  personId: string,
  db?: SupabaseClient,
): Promise<ExcusalRequest[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("excusal_request")
    .select("*")
    .eq("person_id", personId)
    .order("created_at", { ascending: false });
  if (error) console.error("listExcusalRequestsForPerson: query failed", error);
  return ((data ?? []) as ExcusalRequestRow[]).map(excusalRequestFromRow);
}

/**
 * Approve or deny a pending request. Approving creates a real excusal
 * (reusing createExcusal, so attendance math needs no changes) then marks the
 * request reviewed; denying just marks it reviewed. Guards against
 * re-deciding an already-reviewed request (409).
 */
export async function reviewExcusalRequest(
  id: string,
  decision: "approve" | "deny",
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: request, error: fetchError } = await client
    .from("excusal_request")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    console.error("excusal_request fetch failed", { id, error: fetchError });
    return { ok: false, status: 500 };
  }
  if (!request) return { ok: false, status: 404 };
  const r = request as ExcusalRequestRow;
  if (r.status !== "pending") return { ok: false, status: 409 };

  if (decision === "approve") {
    const created = await createExcusal(
      { personId: r.person_id, date: r.date, note: r.reason },
      reviewerId,
      client,
    );
    if (!created.ok) return created;
  }

  const { error, data } = await client
    .from("excusal_request")
    .update({
      status: decision === "approve" ? "approved" : "denied",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending") // atomic guard against a concurrent re-decision
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("excusal_request reviewed but status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  // We already confirmed the row existed and was pending above, so a guarded
  // update matching nothing means a concurrent reviewer just decided it.
  if (!data) return { ok: false, status: 409 };
  return { ok: true, status: 200 };
}

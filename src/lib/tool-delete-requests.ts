import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "./people";
import { deleteTool } from "./tools";
import type { ToolDeleteRequest, ToolDeleteRequestRow } from "./types";
import { toolDeleteRequestFromRow } from "./types";
import { reqString, reqUuid } from "./validate";

export type ToolDeleteRequestInput = { toolId: string; reason: string };

/** Validate a student's tool-delete-request payload. PURE. */
export function parseToolDeleteRequestInput(body: unknown): ToolDeleteRequestInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const toolId = reqUuid(b.toolId);
  if (!toolId) return null;
  const reason = reqString(b.reason, 500);
  if (!reason) return null;
  return { toolId, reason };
}

/** Insert a pending tool-delete request for the given person. */
export async function createToolDeleteRequest(
  personId: string,
  input: ToolDeleteRequestInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool_delete_request")
    .insert({
      tool_id: input.toolId,
      requested_by: personId,
      reason: input.reason,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    // Partial unique index one_pending_tool_delete_request_per_tool.
    if (error.code === "23505") return { ok: false, status: 409 };
    if (error.code === "23503") return { ok: false, status: 400 };
    return { ok: false, status: 500 };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Whether a tool has a pending delete request — detail-page pill. */
export async function hasPendingDeleteRequest(
  toolId: string,
  db?: SupabaseClient,
): Promise<boolean> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool_delete_request")
    .select("id")
    .eq("tool_id", toolId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) console.error("hasPendingDeleteRequest: query failed", error);
  return !!data;
}

export type PendingToolDeleteRequest = ToolDeleteRequest & { name: string; toolName: string };

/**
 * Pending requests, newest first, with the requester's display name and the
 * tool's name. Uses the `person!requested_by` FK-hint embed — tool_delete_request
 * has two person FKs (requested_by + reviewed_by), so an unqualified embed is
 * ambiguous and PostgREST rejects it with PGRST201. `tool` has a single FK, so
 * an unqualified embed is fine.
 */
export async function listPendingToolDeleteRequests(
  db?: SupabaseClient,
): Promise<PendingToolDeleteRequest[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool_delete_request")
    .select("*, person!requested_by (id, first_name, last_name, display_name), tool (name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) console.error("listPendingToolDeleteRequests: query failed", error);
  return (data ?? [])
    .filter((r) => r.person && r.tool)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      const t = r.tool as unknown as { name: string };
      return {
        ...toolDeleteRequestFromRow(r as unknown as ToolDeleteRequestRow),
        name: displayName(p),
        toolName: t.name,
      };
    });
}

/**
 * Approve or deny a pending request. Inverts the excusal order: mark first,
 * then act. Deleting first would cascade the request row away (tool_id FK is
 * ON DELETE CASCADE) and the guarded update below would falsely 409. Guards
 * against re-deciding an already-reviewed request (409); a missing request
 * (404) also covers the "tool already deleted" case, since deleting a tool
 * cascades away its pending request.
 */
export async function reviewToolDeleteRequest(
  id: string,
  decision: "approve" | "deny",
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: request, error: fetchError } = await client
    .from("tool_delete_request")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    console.error("tool_delete_request fetch failed", { id, error: fetchError });
    return { ok: false, status: 500 };
  }
  if (!request) return { ok: false, status: 404 };
  const r = request as ToolDeleteRequestRow;
  if (r.status !== "pending") return { ok: false, status: 409 };

  const { error, data } = await client
    .from("tool_delete_request")
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
    console.error("tool_delete_request status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  // We already confirmed the row existed and was pending above, so a guarded
  // update matching nothing means a concurrent reviewer just decided it.
  if (!data) return { ok: false, status: 409 };

  if (decision === "approve") {
    const deleted = await deleteTool(r.tool_id, client);
    // A 404 here means the tool was already gone (raced deletion) — the
    // request is still correctly marked approved, so treat it as ok.
    if (!deleted.ok && deleted.status !== 404) return deleted;
  }

  return { ok: true, status: 200 };
}

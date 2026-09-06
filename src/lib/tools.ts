import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tool, ToolCheck, ToolCheckKind, ToolCheckRow, ToolCondition, ToolRow, ToolStatus } from "./types";
import { toolCheckFromRow, toolFromRow } from "./types";
import { optInt, optString, reqString, reqUuid } from "./validate";

const TOOL_STATUSES: ToolStatus[] = ["in_service", "needs_attention", "out_of_service", "retired"];
const CHECK_STATUS_AFTER: ToolStatus[] = ["in_service", "needs_attention", "out_of_service"];
const CHECK_KINDS: ToolCheckKind[] = ["inspection", "maintenance", "repair"];
const CHECK_CONDITIONS: ToolCondition[] = ["good", "fair", "poor"];

export type ToolInput = {
  name: string;
  category: string | null;
  location: string | null;
  assetTag: string | null;
  status: ToolStatus;
  maintenanceIntervalDays: number | null;
  notes: string | null;
};

/** Validate a tool payload (create and full-replace PATCH share it). PURE. Null = invalid. */
export function parseToolInput(body: unknown): ToolInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const name = reqString(b.name, 80);
  if (!name) return null;

  const category = optString(b.category, 40);
  if (!category) return null;
  const location = optString(b.location, 80);
  if (!location) return null;
  const assetTag = optString(b.assetTag, 40);
  if (!assetTag) return null;

  if (typeof b.status !== "string" || !TOOL_STATUSES.includes(b.status as ToolStatus)) return null;
  const status = b.status as ToolStatus;

  const maintenanceIntervalDays = optInt(b.maintenanceIntervalDays, 1, 3650);
  if (!maintenanceIntervalDays) return null;

  const notes = optString(b.notes, 2000);
  if (!notes) return null;

  return {
    name,
    category: category.value,
    location: location.value,
    assetTag: assetTag.value,
    status,
    maintenanceIntervalDays: maintenanceIntervalDays.value,
    notes: notes.value,
  };
}

export type CheckInput = {
  toolId: string;
  checkedAt: string;
  kind: ToolCheckKind;
  condition: ToolCondition;
  statusAfter: ToolStatus | null;
  notes: string | null;
};

/** Validate a tool-check payload. PURE. Null = invalid. */
export function parseCheckInput(body: unknown): CheckInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const toolId = reqUuid(b.toolId);
  if (!toolId) return null;

  let checkedAt: string;
  if (b.checkedAt === undefined || b.checkedAt === null) {
    checkedAt = new Date().toISOString();
  } else if (typeof b.checkedAt === "string" && !Number.isNaN(Date.parse(b.checkedAt))) {
    checkedAt = new Date(b.checkedAt).toISOString();
  } else {
    return null;
  }

  if (typeof b.kind !== "string" || !CHECK_KINDS.includes(b.kind as ToolCheckKind)) return null;
  const kind = b.kind as ToolCheckKind;

  if (typeof b.condition !== "string" || !CHECK_CONDITIONS.includes(b.condition as ToolCondition)) return null;
  const condition = b.condition as ToolCondition;

  let statusAfter: ToolStatus | null = null;
  if (b.statusAfter !== undefined && b.statusAfter !== null) {
    if (typeof b.statusAfter !== "string" || !CHECK_STATUS_AFTER.includes(b.statusAfter as ToolStatus)) return null;
    statusAfter = b.statusAfter as ToolStatus;
  }

  const notes = optString(b.notes, 2000);
  if (!notes) return null;

  return { toolId, checkedAt, kind, condition, statusAfter, notes: notes.value };
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function mapWriteError(code: string | undefined): number {
  if (code === FOREIGN_KEY_VIOLATION) return 400;
  if (code === UNIQUE_VIOLATION) return 409;
  return 500;
}

// ---- Tools ----

export async function createTool(
  input: ToolInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool")
    .insert({
      name: input.name,
      category: input.category,
      location: input.location,
      asset_tag: input.assetTag,
      status: input.status,
      maintenance_interval_days: input.maintenanceIntervalDays,
      notes: input.notes,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

export async function updateTool(
  id: string,
  input: ToolInput,
  db?: SupabaseClient,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool")
    .update({
      name: input.name,
      category: input.category,
      location: input.location,
      asset_tag: input.assetTag,
      status: input.status,
      maintenance_interval_days: input.maintenanceIntervalDays,
      notes: input.notes,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

/** `deleteUsage` with the table swapped: checks and any pending delete request cascade. */
export async function deleteTool(id: string, db?: SupabaseClient): Promise<{ ok: true } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("tool").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { error } = await client.from("tool").delete().eq("id", id);
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true };
}

type ToolWithCheckRow = ToolRow & { tool_check: { checked_at: string }[] };

/**
 * Never-checked tools first, then oldest-checked first, retired tools last
 * regardless of when checked. PURE — operates on whatever already carries
 * `status` and `lastCheckedAt` (the `listTools` embed, or a test fixture).
 */
export function sortByLastChecked<T extends { status: ToolStatus; lastCheckedAt: string | null }>(rows: T[]): T[] {
  const tier = (r: T) => (r.status === "retired" ? 1 : 0);
  return [...rows].sort((a, b) => {
    const tierDiff = tier(a) - tier(b);
    if (tierDiff !== 0) return tierDiff;
    if (a.lastCheckedAt === null && b.lastCheckedAt === null) return 0;
    if (a.lastCheckedAt === null) return -1;
    if (b.lastCheckedAt === null) return 1;
    return a.lastCheckedAt.localeCompare(b.lastCheckedAt);
  });
}

/** All tools with their most recent check timestamp, in due-first order (spec §3). */
export async function listTools(db?: SupabaseClient): Promise<(Tool & { lastCheckedAt: string | null })[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("tool")
    .select("*, tool_check(checked_at)")
    .order("checked_at", { referencedTable: "tool_check", ascending: false })
    .limit(1, { referencedTable: "tool_check" });
  const rows = ((data ?? []) as ToolWithCheckRow[]).map((row) => ({
    ...toolFromRow(row),
    lastCheckedAt: row.tool_check[0]?.checked_at ?? null,
  }));
  return sortByLastChecked(rows);
}

export async function getTool(id: string, db?: SupabaseClient): Promise<Tool | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("tool").select("*").eq("id", id).maybeSingle();
  return data ? toolFromRow(data as ToolRow) : null;
}

/**
 * "Due" is computed, never stored (spec §1.5). No interval → null; a retired
 * tool → null; never checked → the tool's `createdAt` (a baseline inspection
 * is due immediately); else `lastCheckedAt + interval days`. PURE.
 */
export function nextDueAt(
  tool: { maintenanceIntervalDays: number | null; status: ToolStatus; createdAt: string },
  lastCheckedAt: string | null,
): string | null {
  if (tool.maintenanceIntervalDays === null) return null;
  if (tool.status === "retired") return null;
  if (lastCheckedAt === null) return new Date(tool.createdAt).toISOString();
  const due = new Date(lastCheckedAt);
  due.setUTCDate(due.getUTCDate() + tool.maintenanceIntervalDays);
  return due.toISOString();
}

// ---- Checks ----

export async function listChecks(
  { toolId, limit }: { toolId?: string; limit?: number },
  db?: SupabaseClient,
): Promise<ToolCheck[]> {
  const client = db ?? (await import("./db")).getDb();
  let query = client
    .from("tool_check")
    .select("*, person (first_name, last_name, display_name)")
    .order("checked_at", { ascending: false });
  if (toolId) query = query.eq("tool_id", toolId);
  if (limit) query = query.limit(limit);
  const { data } = await query;
  return ((data ?? []) as ToolCheckRow[]).map(toolCheckFromRow);
}

export async function createCheck(
  input: CheckInput,
  checkedBy: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("tool_check")
    .insert({
      tool_id: input.toolId,
      checked_by: checkedBy,
      checked_at: input.checkedAt,
      kind: input.kind,
      condition: input.condition,
      status_after: input.statusAfter,
      notes: input.notes,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

/** No edit path for a mistyped check entry, so a mentor deletes and re-logs instead. */
export async function deleteCheck(id: string, db?: SupabaseClient): Promise<{ ok: true } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("tool_check").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { error } = await client.from("tool_check").delete().eq("id", id);
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true };
}

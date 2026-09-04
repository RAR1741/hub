import type { SupabaseClient } from "@supabase/supabase-js";
import type { Battery, BatteryRow, BatteryStatus, BatteryUsage, BatteryUsageRow } from "./types";
import { batteryFromRow, batteryUsageFromRow } from "./types";
import { optInt, optString, reqString, reqUuid } from "./validate";

const EVENT_KEY_RE = /^\d{4}[a-z0-9]+$/;

/** Optional finite number within [min, max]. Same outer-null convention as optString/optInt. */
function optFinite(v: unknown, min: number, max: number): { value: number | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return { value: v };
}

export type BatteryInput = {
  number: string;
  yearAcquired: number | null;
  model: string | null;
  serialDateCode: string | null;
  manufacturer: string | null;
  tradeName: string | null;
  ampHourRating: number | null;
  notes: string | null;
  status: BatteryStatus;
  retiredAt: string | null;
  retiredReason: string | null;
};

/**
 * Validate a battery payload (create and full-replace PATCH share it). PURE.
 * Null = invalid. `retired` without `retiredAt` defaults to now; `active`
 * forces both retired fields null regardless of what was submitted.
 */
export function parseBatteryInput(body: unknown): BatteryInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const number = reqString(b.number, 20);
  if (!number) return null;

  const yearAcquired = optInt(b.yearAcquired, 1990, 2100);
  if (!yearAcquired) return null;
  const model = optString(b.model, 80);
  if (!model) return null;
  const serialDateCode = optString(b.serialDateCode, 80);
  if (!serialDateCode) return null;
  const manufacturer = optString(b.manufacturer, 80);
  if (!manufacturer) return null;
  const tradeName = optString(b.tradeName, 80);
  if (!tradeName) return null;
  // Exclusive lower bound (0 is not a valid rating); optFinite's range check is inclusive.
  const ampHourRating = optFinite(b.ampHourRating, Number.MIN_VALUE, 1000);
  if (!ampHourRating) return null;
  const notes = optString(b.notes, 2000);
  if (!notes) return null;

  if (b.status !== "active" && b.status !== "retired") return null;
  const status = b.status;

  let retiredAt: string | null = null;
  if (b.retiredAt !== undefined && b.retiredAt !== null) {
    if (typeof b.retiredAt !== "string" || Number.isNaN(Date.parse(b.retiredAt))) return null;
    retiredAt = new Date(b.retiredAt).toISOString();
  }
  const retiredReason = optString(b.retiredReason, 500);
  if (!retiredReason) return null;

  if (status === "retired") {
    retiredAt = retiredAt ?? new Date().toISOString();
  } else {
    retiredAt = null;
  }

  return {
    number,
    yearAcquired: yearAcquired.value,
    model: model.value,
    serialDateCode: serialDateCode.value,
    manufacturer: manufacturer.value,
    tradeName: tradeName.value,
    ampHourRating: ampHourRating.value,
    notes: notes.value,
    status,
    retiredAt,
    retiredReason: status === "retired" ? retiredReason.value : null,
  };
}

export type UsageInput = {
  batteryId: string;
  usedAt: string;
  eventKey: string | null;
  matchKey: string | null;
  hadProblem: boolean;
  problemDescription: string | null;
  wiggleTestOk: boolean | null;
  chargerTestOk: boolean | null;
  rintOhms: number | null;
  chargePrePct: number | null;
  chargePostPct: number | null;
  notes: string | null;
};

/** Validate a usage-log payload. PURE. Null = invalid. */
export function parseUsageInput(body: unknown): UsageInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const batteryId = reqUuid(b.batteryId);
  if (!batteryId) return null;

  let usedAt: string;
  if (b.usedAt === undefined || b.usedAt === null) {
    usedAt = new Date().toISOString();
  } else if (typeof b.usedAt === "string" && !Number.isNaN(Date.parse(b.usedAt))) {
    usedAt = new Date(b.usedAt).toISOString();
  } else {
    return null;
  }

  const eventKeyOpt = optString(b.eventKey, 20);
  if (!eventKeyOpt) return null;
  let eventKey: string | null = null;
  if (eventKeyOpt.value !== null) {
    const lowered = eventKeyOpt.value.toLowerCase();
    if (!EVENT_KEY_RE.test(lowered)) return null;
    eventKey = lowered;
  }

  const matchKeyOpt = optString(b.matchKey, 20);
  if (!matchKeyOpt) return null;

  let hadProblem = false;
  if (b.hadProblem !== undefined) {
    if (typeof b.hadProblem !== "boolean") return null;
    hadProblem = b.hadProblem;
  }

  const problemDescriptionOpt = optString(b.problemDescription, 1000);
  if (!problemDescriptionOpt) return null;

  let wiggleTestOk: boolean | null = null;
  if (b.wiggleTestOk !== undefined && b.wiggleTestOk !== null) {
    if (typeof b.wiggleTestOk !== "boolean") return null;
    wiggleTestOk = b.wiggleTestOk;
  }
  let chargerTestOk: boolean | null = null;
  if (b.chargerTestOk !== undefined && b.chargerTestOk !== null) {
    if (typeof b.chargerTestOk !== "boolean") return null;
    chargerTestOk = b.chargerTestOk;
  }

  const rintOhms = optFinite(b.rintOhms, 0, 10);
  if (!rintOhms) return null;
  const chargePrePct = optInt(b.chargePrePct, 0, 999);
  if (!chargePrePct) return null;
  const chargePostPct = optInt(b.chargePostPct, 0, 999);
  if (!chargePostPct) return null;
  const notes = optString(b.notes, 2000);
  if (!notes) return null;

  return {
    batteryId,
    usedAt,
    eventKey,
    matchKey: matchKeyOpt.value,
    hadProblem,
    problemDescription: hadProblem ? problemDescriptionOpt.value : null,
    wiggleTestOk,
    chargerTestOk,
    rintOhms: rintOhms.value,
    chargePrePct: chargePrePct.value,
    chargePostPct: chargePostPct.value,
    notes: notes.value,
  };
}

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function mapWriteError(code: string | undefined): number {
  if (code === FOREIGN_KEY_VIOLATION) return 400;
  if (code === UNIQUE_VIOLATION) return 409;
  return 500;
}

// ---- Batteries ----

export async function createBattery(
  input: BatteryInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("battery")
    .insert({
      number: input.number,
      year_acquired: input.yearAcquired,
      model: input.model,
      serial_date_code: input.serialDateCode,
      manufacturer: input.manufacturer,
      trade_name: input.tradeName,
      amp_hour_rating: input.ampHourRating,
      notes: input.notes,
      status: input.status,
      retired_at: input.retiredAt,
      retired_reason: input.retiredReason,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

export async function updateBattery(
  id: string,
  input: BatteryInput,
  db?: SupabaseClient,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("battery")
    .update({
      number: input.number,
      year_acquired: input.yearAcquired,
      model: input.model,
      serial_date_code: input.serialDateCode,
      manufacturer: input.manufacturer,
      trade_name: input.tradeName,
      amp_hour_rating: input.ampHourRating,
      notes: input.notes,
      status: input.status,
      retired_at: input.retiredAt,
      retired_reason: input.retiredReason,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

type BatteryWithUsageRow = BatteryRow & { battery_usage: { used_at: string }[] };

/**
 * Never-used batteries first, then least-recently-used first, retired
 * batteries last regardless of use. PURE — operates on whatever already
 * carries `status` and `lastUsedAt` (the `listBatteries` embed, or a test
 * fixture).
 */
export function sortByLastUsed<T extends { status: BatteryStatus; lastUsedAt: string | null }>(rows: T[]): T[] {
  const tier = (r: T) => (r.status === "retired" ? 1 : 0);
  return [...rows].sort((a, b) => {
    const tierDiff = tier(a) - tier(b);
    if (tierDiff !== 0) return tierDiff;
    if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
    if (a.lastUsedAt === null) return -1;
    if (b.lastUsedAt === null) return 1;
    return a.lastUsedAt.localeCompare(b.lastUsedAt);
  });
}

/** All batteries with their most recent usage timestamp, in LRU order (spec §3). */
export async function listBatteries(db?: SupabaseClient): Promise<(Battery & { lastUsedAt: string | null })[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("battery")
    .select("*, battery_usage(used_at)")
    .order("used_at", { referencedTable: "battery_usage", ascending: false })
    .limit(1, { referencedTable: "battery_usage" });
  const rows = ((data ?? []) as BatteryWithUsageRow[]).map((row) => ({
    ...batteryFromRow(row),
    lastUsedAt: row.battery_usage[0]?.used_at ?? null,
  }));
  return sortByLastUsed(rows);
}

export async function getBattery(id: string, db?: SupabaseClient): Promise<Battery | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("battery").select("*").eq("id", id).maybeSingle();
  return data ? batteryFromRow(data as BatteryRow) : null;
}

// ---- Usage ----

export async function listUsage(
  { batteryId, limit }: { batteryId?: string; limit?: number },
  db?: SupabaseClient,
): Promise<BatteryUsage[]> {
  const client = db ?? (await import("./db")).getDb();
  let query = client
    .from("battery_usage")
    .select("*, person (first_name, last_name, display_name)")
    .order("used_at", { ascending: false });
  if (batteryId) query = query.eq("battery_id", batteryId);
  if (limit) query = query.limit(limit);
  const { data } = await query;
  return ((data ?? []) as BatteryUsageRow[]).map(batteryUsageFromRow);
}

export async function createUsage(
  input: UsageInput,
  techId: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("battery_usage")
    .insert({
      battery_id: input.batteryId,
      tech_id: techId,
      used_at: input.usedAt,
      event_key: input.eventKey,
      match_key: input.matchKey,
      had_problem: input.hadProblem,
      problem_description: input.problemDescription,
      wiggle_test_ok: input.wiggleTestOk,
      charger_test_ok: input.chargerTestOk,
      rint_ohms: input.rintOhms,
      charge_pre_pct: input.chargePrePct,
      charge_post_pct: input.chargePostPct,
      notes: input.notes,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true, id: data.id as string };
}

/** No edit path for a mistyped usage entry, so a mentor deletes and re-logs instead. */
export async function deleteUsage(id: string, db?: SupabaseClient): Promise<{ ok: true } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: exists } = await client.from("battery_usage").select("id").eq("id", id).maybeSingle();
  if (!exists) return { ok: false, status: 404 };
  const { error } = await client.from("battery_usage").delete().eq("id", id);
  if (error) return { ok: false, status: mapWriteError(error.code) };
  return { ok: true };
}

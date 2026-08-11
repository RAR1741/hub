import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildDay, BuildDayKind, BuildDayRow } from "./types";
import { buildDayFromRow } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: BuildDayKind[] = ["required", "optional"];

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}

export type BuildDayInput = { date: string; kind: BuildDayKind };

/** Validate a manual build-day payload. PURE. */
export function parseBuildDayInput(body: unknown): BuildDayInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isValidDate(b.date)) return null;
  const kind = KINDS.find((k) => k === b.kind);
  if (!kind) return null;
  return { date: b.date, kind };
}

/** Validate a PATCH { kind } payload. PURE. */
export function parseBuildDayKind(body: unknown): BuildDayKind | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  return KINDS.find((k) => k === b.kind) ?? null;
}

export async function listBuildDays(
  range: { from: string; to: string },
  db?: SupabaseClient,
): Promise<BuildDay[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("build_day")
    .select("*")
    .gte("date", range.from)
    .lte("date", range.to)
    .order("date");
  return ((data ?? []) as BuildDayRow[]).map(buildDayFromRow);
}

/** Manual create/override: source='manual' wins over a prior gcal row. */
export async function createManualBuildDay(
  input: BuildDayInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("build_day")
    .upsert({ date: input.date, kind: input.kind, source: "manual" }, { onConflict: "date" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function setBuildDayKind(
  date: string,
  kind: BuildDayKind,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("build_day")
    .update({ kind })
    .eq("date", date)
    .select("date")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteBuildDay(
  date: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client.from("build_day").delete().eq("date", date);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

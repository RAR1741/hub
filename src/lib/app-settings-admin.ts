import type { SupabaseClient } from "@supabase/supabase-js";

export type SettingsInput = {
  teamTimezone: string;
  gcalCalendarId: string;
  autoCloseEnabled: boolean;
  autoCloseHours: number;
  maxShiftHours: number;
  seasonHoursGoal: number;
};

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intInRange(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/** Validate the admin settings payload. PURE. */
export function parseSettingsInput(body: unknown): SettingsInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isValidTimeZone(b.teamTimezone)) return null;
  const gcalCalendarId = typeof b.gcalCalendarId === "string" ? b.gcalCalendarId.trim() : null;
  if (gcalCalendarId === null || gcalCalendarId.length > 200) return null;
  if (typeof b.autoCloseEnabled !== "boolean") return null;
  const autoCloseEnabled = b.autoCloseEnabled;
  const autoCloseHours = intInRange(b.autoCloseHours, 1, 24);
  const maxShiftHours = intInRange(b.maxShiftHours, 1, 48);
  const seasonHoursGoal = intInRange(b.seasonHoursGoal, 0, 100_000);
  if (autoCloseHours === null || maxShiftHours === null || seasonHoursGoal === null) return null;
  return {
    teamTimezone: b.teamTimezone,
    gcalCalendarId,
    autoCloseEnabled,
    autoCloseHours,
    maxShiftHours,
    seasonHoursGoal,
  };
}

export async function setSettings(
  input: SettingsInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const rows = [
    { key: "team_timezone", value: input.teamTimezone },
    { key: "gcal_calendar_id", value: input.gcalCalendarId },
    { key: "auto_close_enabled", value: input.autoCloseEnabled },
    { key: "auto_close_hours", value: input.autoCloseHours },
    { key: "max_shift_hours", value: input.maxShiftHours },
    { key: "season_hours_goal", value: input.seasonHoursGoal },
  ];
  const { error } = await client.from("app_setting").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

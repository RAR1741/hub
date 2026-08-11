import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, MeetingRow } from "./types";
import { meetingFromRow } from "./types";

export async function listUpcomingMeetings(
  nowIso: string,
  limit: number,
  db?: SupabaseClient,
): Promise<Meeting[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("meeting")
    .select("*")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as MeetingRow[]).map(meetingFromRow);
}

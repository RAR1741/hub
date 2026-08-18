import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateOf } from "./attendance";
import { buildServiceAccountJwt as buildJwt, fetchGoogleAccessToken } from "./google-auth";

export type GcalTransport = typeof globalThis.fetch;

export type GcalCredentials = {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
};

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

// Sync pulls a window of ±12 months around "now" so a recently-edited past
// event still updates and the far future doesn't accumulate forever.
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// Attendance days default to OPTIONAL. A build day is REQUIRED only when an
// event on it either says "mandatory" in the title, or is a Thursday-night
// meeting (Thursday, starting at/after this hour, team-local).
const MANDATORY_RE = /mandatory/i;
const THURSDAY_NIGHT_HOUR = 17; // 5:00 PM local

/**
 * Resolve the calendar id: the `GOOGLE_CALENDAR_ID` env var wins when set,
 * otherwise fall back to the `gcal_calendar_id` app setting (editable in
 * /admin/settings). PURE — the caller reads both values and passes them in.
 */
export function pickCalendarId(
  envValue: string | undefined,
  dbValue: string | undefined,
): string {
  return (envValue ?? "").trim() || (dbValue ?? "").trim();
}

/** Read service-account creds from env; null if not fully configured. */
export function gcalCredentialsFromEnv(calendarId: string): GcalCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  // Private keys in env keep literal "\n"; restore real newlines for the PEM parser.
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey || !calendarId) return null;
  return { clientEmail, privateKey, calendarId };
}

/** Signed RS256 service-account assertion for the token exchange. */
export function buildServiceAccountJwt(
  creds: Pick<GcalCredentials, "clientEmail" | "privateKey">,
  now: () => number = Date.now,
): string {
  return buildJwt(creds, { scope: SCOPE }, now);
}

async function fetchAccessToken(deps: GcalDeps): Promise<string> {
  return fetchGoogleAccessToken(deps.fetch, deps.credentials, { scope: SCOPE }, deps.now);
}

type GcalEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type GcalDeps = {
  fetch: GcalTransport;
  db: SupabaseClient;
  credentials: GcalCredentials;
  tz: string;
  now?: () => number;
};

export type SyncResult = { meetings: number; buildDays: number; backfilledPeriods: number; linkedEventsUpdated: number };

/**
 * Does this period already have at least one meeting? Used to decide whether a
 * past period still needs a backfill. The bounds are generous by a few hours at
 * each edge — good enough to answer "is this period empty?", which is all we
 * need. Returns false on a query error (treat as empty → try to backfill).
 */
async function periodHasMeetings(
  db: SupabaseClient,
  startsOn: string,
  endsOn: string,
): Promise<boolean> {
  const { data } = await db
    .from("meeting")
    .select("id")
    .gte("starts_at", `${startsOn}T00:00:00Z`)
    .lte("starts_at", `${endsOn}T23:59:59Z`)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Is a calendar event a REQUIRED attendance day? True when the title contains
 * "mandatory", or the event starts on a Thursday at/after 5 PM team-local (the
 * regular Thursday-night meeting). All-day events (no time) qualify only via
 * the title. Everything else is optional. PURE.
 */
export function isRequiredEvent(
  e: Pick<GcalEvent, "summary" | "start">,
  tz: string,
): boolean {
  if (MANDATORY_RE.test(e.summary ?? "")) return true;
  const dt = e.start?.dateTime;
  if (!dt) return false; // all-day event: no "night" time to check
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(dt));
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Thu" && hour >= THURSDAY_NIGHT_HOUR;
}

export type LinkedEventRow = {
  id: string;
  gcal_event_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  gcal_missing: boolean;
};

export type MeetingLite = { gcal_event_id: string; title: string; starts_at: string; ends_at: string };

export type LinkedEventWrite = {
  id: string;
  name?: string;
  starts_at?: string;
  ends_at?: string;
  gcal_missing: boolean;
};

/**
 * Diff `event` rows linked to a calendar event against the just-synced
 * `meeting` table. PURE. Only returns rows that actually need a DB write —
 * a linked event with nothing changed and no flag to clear produces no
 * write, so a sync run doesn't touch every linked event every time.
 */
export function diffLinkedEvents(
  linkedEvents: LinkedEventRow[],
  meetingsByGcalId: Map<string, MeetingLite>,
): LinkedEventWrite[] {
  const writes: LinkedEventWrite[] = [];
  for (const row of linkedEvents) {
    const meeting = meetingsByGcalId.get(row.gcal_event_id);
    if (!meeting) {
      if (!row.gcal_missing) writes.push({ id: row.id, gcal_missing: true });
      continue;
    }
    const changed =
      meeting.title !== row.name || meeting.starts_at !== row.starts_at || meeting.ends_at !== row.ends_at;
    if (changed) {
      writes.push({
        id: row.id,
        name: meeting.title,
        starts_at: meeting.starts_at,
        ends_at: meeting.ends_at,
        gcal_missing: false,
      });
    } else if (row.gcal_missing) {
      writes.push({ id: row.id, gcal_missing: false });
    }
  }
  return writes;
}

async function fetchAllEvents(
  deps: GcalDeps,
  token: string,
  timeMin: string,
  timeMax: string,
): Promise<GcalEvent[]> {
  const items: GcalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        deps.credentials.calendarId,
      )}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await deps.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
    const json = (await res.json()) as { items?: GcalEvent[]; nextPageToken?: string };
    items.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return items;
}

/**
 * Reconcile `event` rows linked to a calendar event against the meeting
 * table this same sync run just refreshed. Only events that haven't ended
 * yet are considered — matches the sync's own rolling-window philosophy, no
 * point chasing an event already over. Returns the count of events whose
 * name/starts_at/ends_at actually changed (not counting flag-only writes).
 */
async function syncLinkedEvents(db: SupabaseClient, nowIso: string): Promise<number> {
  const { data: linkedData } = await db
    .from("event")
    .select("id, gcal_event_id, name, starts_at, ends_at, gcal_missing")
    .not("gcal_event_id", "is", null)
    .gte("ends_at", nowIso);
  const linked = (linkedData ?? []) as LinkedEventRow[];
  if (linked.length === 0) return 0;

  const { data: meetingData } = await db
    .from("meeting")
    .select("gcal_event_id, title, starts_at, ends_at")
    .in("gcal_event_id", linked.map((r) => r.gcal_event_id));
  const meetingsByGcalId = new Map(
    ((meetingData ?? []) as MeetingLite[]).map((m) => [m.gcal_event_id, m] as const),
  );

  const writes = diffLinkedEvents(linked, meetingsByGcalId);
  for (const { id, ...patch } of writes) {
    await db.from("event").update(patch).eq("id", id);
  }
  return writes.filter((w) => w.name !== undefined).length;
}

export async function syncCalendar(deps: GcalDeps): Promise<SyncResult> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const rollingMinIso = new Date(nowMs - WINDOW_MS).toISOString();
  const timeMax = new Date(nowMs + WINDOW_MS).toISOString();
  const rollingMinDate = localDateOf(rollingMinIso, deps.tz);

  // Load the season calendar. It does two jobs here: (a) any past period that
  // has no meetings yet gets pulled into the fetch window so its events
  // backfill, and (b) the far-past meeting prune is bounded at the EARLIEST
  // period, never at the (dynamic) fetch window — otherwise a run made after
  // everything is backfilled would collapse the window to `now − 1yr` and
  // delete all the history the previous runs built.
  const { data: periodData } = await deps.db
    .from("period")
    .select("id, starts_on, ends_on")
    .order("starts_on", { ascending: true });
  const periods = (periodData ?? []) as { id: string; starts_on: string; ends_on: string }[];

  // Extend the fetch window back over each empty past period. A period starting
  // within the rolling window is already covered. A period with no calendar
  // events at all stays "empty" and is re-fetched every run — acceptable, and
  // matches "doesn't have meetings" literally.
  let fetchMinIso = rollingMinIso;
  let backfilledPeriods = 0;
  for (const p of periods) {
    if (p.starts_on >= rollingMinDate) continue; // already inside the rolling window
    if (await periodHasMeetings(deps.db, p.starts_on, p.ends_on)) continue;
    backfilledPeriods++;
    const pStartIso = `${p.starts_on}T00:00:00Z`;
    if (Date.parse(pStartIso) < Date.parse(fetchMinIso)) fetchMinIso = pStartIso;
  }

  const token = await fetchAccessToken(deps);
  const allItems = await fetchAllEvents(deps, token, fetchMinIso, timeMax);
  const events = allItems.filter((e) => e.id && (e.start?.dateTime || e.start?.date));
  if (events.length === 0) {
    const linkedEventsUpdated = await syncLinkedEvents(deps.db, new Date(nowMs).toISOString());
    return { meetings: 0, buildDays: 0, backfilledPeriods, linkedEventsUpdated };
  }

  const syncedAt = new Date(nowMs).toISOString();
  const meetingRows = events.map((e) => {
    const startsAt = e.start!.dateTime ?? `${e.start!.date}T00:00:00Z`;
    let endsAt: string;
    if (e.end?.dateTime) endsAt = e.end.dateTime;
    else if (e.end?.date) endsAt = `${e.end.date}T00:00:00Z`;
    else endsAt = startsAt;
    return {
      gcal_event_id: e.id,
      title: e.summary ?? "(untitled)",
      starts_at: startsAt,
      ends_at: endsAt,
      synced_at: syncedAt,
    };
  });
  const { error: meetingError } = await deps.db
    .from("meeting")
    .upsert(meetingRows, { onConflict: "gcal_event_id" });
  if (meetingError) throw new Error(`meeting upsert failed: ${meetingError.message}`);

  // Prune gcal-sourced meetings that fell out of the calendar entirely (deleted
  // upstream) but sit within the window this run actually fetched — the upsert
  // above only stamps synced_at for events still present, so any row in this
  // range whose synced_at predates this run is stale and no longer exists on
  // the calendar. Scoped to [fetchMinIso, timeMax) so it doesn't overlap the
  // far-past/far-future prunes below (which use different bounds and don't
  // need the synced_at check).
  await deps.db
    .from("meeting")
    .delete()
    .gte("starts_at", fetchMinIso)
    .lt("starts_at", timeMax)
    .not("gcal_event_id", "is", null)
    .lt("synced_at", syncedAt);

  // Prune gcal-sourced meetings outside the calendar's coverage. The far-past
  // bound is the EARLIEST period's start (never fetchMin — see above), so
  // backfilled history survives a later, narrower run; the far-future bound is
  // the rolling window edge. Scoped to gcal_event_id IS NOT NULL so a manual
  // (admin-created) meeting outside this range is never swept up.
  const pruneMinIso = periods.length ? `${periods[0].starts_on}T00:00:00Z` : rollingMinIso;
  await deps.db.from("meeting").delete().lt("starts_at", pruneMinIso).not("gcal_event_id", "is", null);
  await deps.db.from("meeting").delete().gte("starts_at", timeMax).not("gcal_event_id", "is", null);

  // One build_day per distinct local start date. Its kind is REQUIRED if ANY
  // event on that date is required (mandatory title or Thursday night), else
  // OPTIONAL. All-day events carry no time component, so their date is used
  // verbatim — running it through localDateOf would shift it a day earlier in
  // UTC-negative timezones. Timed events convert their instant to team-local.
  const dateKinds = new Map<string, "required" | "optional">();
  events.forEach((e, i) => {
    const date = e.start!.dateTime
      ? localDateOf(meetingRows[i].starts_at, deps.tz)
      : e.start!.date!;
    if (!dateKinds.has(date)) dateKinds.set(date, "optional");
    if (isRequiredEvent(e, deps.tz)) dateKinds.set(date, "required");
  });
  const buildDayRows = [...dateKinds].map(([date, kind]) => ({
    date,
    kind,
    source: "gcal",
  }));

  // The sync owns gcal-sourced build days: clear them so a re-sync reclassifies
  // (e.g. after the calendar changes), then re-insert. Scoped to the LOCAL-date
  // range we actually fetched (same localDateOf used for classification, so the
  // boundary can't drift by a day) — a global delete would wipe historical gcal
  // build days from periods this run didn't re-fetch. `ignoreDuplicates` leaves
  // any manual admin override (source = 'manual') on a date untouched.
  const clearFromDate = localDateOf(fetchMinIso, deps.tz);
  const clearToDate = localDateOf(timeMax, deps.tz);
  const { error: bdDeleteError } = await deps.db
    .from("build_day")
    .delete()
    .eq("source", "gcal")
    .gte("date", clearFromDate)
    .lte("date", clearToDate);
  if (bdDeleteError) throw new Error(`build_day cleanup failed: ${bdDeleteError.message}`);
  const { error: bdError } = await deps.db
    .from("build_day")
    .upsert(buildDayRows, { onConflict: "date", ignoreDuplicates: true });
  if (bdError) throw new Error(`build_day upsert failed: ${bdError.message}`);

  const linkedEventsUpdated = await syncLinkedEvents(deps.db, new Date(nowMs).toISOString());
  return { meetings: meetingRows.length, buildDays: buildDayRows.length, backfilledPeriods, linkedEventsUpdated };
}

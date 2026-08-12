import { createSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateOf } from "./attendance";

export type GcalTransport = typeof globalThis.fetch;

export type GcalCredentials = {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

// Sync pulls a window of ±12 months around "now" so a recently-edited past
// event still updates and the far future doesn't accumulate forever.
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// Attendance days default to OPTIONAL. A build day is REQUIRED only when an
// event on it either says "mandatory" in the title, or is a Thursday-night
// meeting (Thursday, starting at/after this hour, team-local).
const MANDATORY_RE = /mandatory/i;
const THURSDAY_NIGHT_HOUR = 17; // 5:00 PM local

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

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
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(creds.privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

async function fetchAccessToken(deps: GcalDeps): Promise<string> {
  const assertion = buildServiceAccountJwt(deps.credentials, deps.now);
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return json.access_token;
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

export type SyncResult = { meetings: number; buildDays: number };

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

export async function syncCalendar(deps: GcalDeps): Promise<SyncResult> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const timeMin = new Date(nowMs - WINDOW_MS).toISOString();
  const timeMax = new Date(nowMs + WINDOW_MS).toISOString();

  const token = await fetchAccessToken(deps);
  const allItems = await fetchAllEvents(deps, token, timeMin, timeMax);
  const events = allItems.filter((e) => e.id && (e.start?.dateTime || e.start?.date));
  if (events.length === 0) return { meetings: 0, buildDays: 0 };

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

  // Prune gcal-sourced meetings outside the synced window so a prior wider
  // sync's stale far-past/far-future rows don't linger. Scoped to
  // gcal_event_id IS NOT NULL so a manual (admin-created) meeting outside the
  // ±12-month window is never swept up by this cleanup.
  await deps.db.from("meeting").delete().lt("starts_at", timeMin).not("gcal_event_id", "is", null);
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
  // (e.g. after the calendar changes), then re-insert. `ignoreDuplicates` leaves
  // any manual admin override (source = 'manual') on a date untouched.
  const { error: bdDeleteError } = await deps.db
    .from("build_day")
    .delete()
    .eq("source", "gcal");
  if (bdDeleteError) throw new Error(`build_day cleanup failed: ${bdDeleteError.message}`);
  const { error: bdError } = await deps.db
    .from("build_day")
    .upsert(buildDayRows, { onConflict: "date", ignoreDuplicates: true });
  if (bdError) throw new Error(`build_day upsert failed: ${bdError.message}`);

  return { meetings: meetingRows.length, buildDays: buildDayRows.length };
}

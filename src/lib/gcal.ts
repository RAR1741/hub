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

async function fetchAllEvents(deps: GcalDeps, token: string): Promise<GcalEvent[]> {
  const timeMin = new Date(deps.now ? deps.now() : Date.now()).toISOString();
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
  const token = await fetchAccessToken(deps);
  const allItems = await fetchAllEvents(deps, token);
  const events = allItems.filter((e) => e.id && (e.start?.dateTime || e.start?.date));
  if (events.length === 0) return { meetings: 0, buildDays: 0 };

  const syncedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
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

  // One build_day per distinct start date; never overwrite an existing row.
  // All-day events carry no time component, so their date is used verbatim —
  // running it through localDateOf would shift it a day earlier in UTC-negative
  // timezones. Timed events still convert their instant to the team-local date.
  const dates = [
    ...new Set(
      events.map((e, i) =>
        e.start!.dateTime ? localDateOf(meetingRows[i].starts_at, deps.tz) : e.start!.date!,
      ),
    ),
  ];
  const buildDayRows = dates.map((date) => ({ date, kind: "required", source: "gcal" }));
  const { error: bdError } = await deps.db
    .from("build_day")
    .upsert(buildDayRows, { onConflict: "date", ignoreDuplicates: true });
  if (bdError) throw new Error(`build_day upsert failed: ${bdError.message}`);

  return { meetings: meetingRows.length, buildDays: buildDayRows.length };
}

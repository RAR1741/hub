import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithSession } from "./first-auth";
import { nameKey } from "./name-match";
import { getSetting } from "./settings";

export type FirstPerson = {
  peopleId: number;
  firstName: string; // name_first
  lastName: string; // name_last
  email: string; // lowercased
  consentRelease: boolean; // any-true across role entries
  screeningStatus: string | null; // e.g. "green" | "blue" | "orange"
  screeningText: string | null;
  trainingStatus: string | null;
};

export type FirstSyncReport = {
  ranAt: string; // ISO
  rosterCount: number; // unique adults on the FIRST roster
  matched: number;
  updated: number;
  unmatchedFirst: { peopleId: number; name: string; email: string }[];
  unmatchedHub: { personId: string; name: string }[];
};

export type HubCandidate = {
  personId: string;
  name: string;
  firstName: string;
  lastName: string;
  firstPeopleId: number | null;
  emails: string[];
};

const ADULT_ROLE_CATEGORIES = new Set(["Primary Team Contacts", "Additional Team Contacts"]);

/**
 * Locate `teamContactsModel = {...}` in the page HTML and JSON.parse the
 * object literal. Brace-counts (respecting string literals) from the first
 * `{` after the `=` to the matching `}`, since the object may contain nested
 * braces. PURE.
 */
export function parseTeamContactsModel(html: string): unknown {
  const markerIdx = html.indexOf("teamContactsModel");
  if (markerIdx === -1) {
    throw new Error("first-sync: teamContactsModel marker not found in roster HTML");
  }
  const eqIdx = html.indexOf("=", markerIdx);
  const start = html.indexOf("{", eqIdx);
  if (eqIdx === -1 || start === -1) {
    throw new Error("first-sync: teamContactsModel marker found but no object literal follows");
  }

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") {
        i++; // skip escaped char
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error("first-sync: teamContactsModel object literal is not closed");
  }
  return JSON.parse(html.slice(start, end + 1));
}

type PeopleRole = {
  peopleId: number;
  name_first: string;
  name_last: string;
  email: string;
  role_category: string;
  ConsentReleaseStatus: boolean;
};

/** Filter to adult roles, dedupe by peopleId, merge consent any-true. PURE. */
export function adultsFromModel(model: unknown): FirstPerson[] {
  const roles = (model as { PeopleRoles?: PeopleRole[] }).PeopleRoles ?? [];
  const byId = new Map<number, FirstPerson>();
  for (const role of roles) {
    if (!ADULT_ROLE_CATEGORIES.has(role.role_category)) continue;
    const existing = byId.get(role.peopleId);
    if (existing) {
      existing.consentRelease = existing.consentRelease || !!role.ConsentReleaseStatus;
      continue;
    }
    byId.set(role.peopleId, {
      peopleId: role.peopleId,
      firstName: role.name_first,
      lastName: role.name_last,
      email: role.email.toLowerCase(),
      consentRelease: !!role.ConsentReleaseStatus,
      screeningStatus: null,
      screeningText: null,
      trainingStatus: null,
    });
  }
  return [...byId.values()];
}

/** GetPersonStatus requires REPEATED &ids= params — comma-separated silently returns []. PURE. */
export function statusUrl(teamProfileId: string, ids: number[]): string {
  const params = ids.map((id) => `ids=${id}`).join("&");
  return `https://my.firstinspires.org/Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=${teamProfileId}&${params}`;
}

/**
 * Match ladder, first rung wins, each hub candidate claimable once:
 * (1) existing firstPeopleId; (2) email vs candidate.emails (case-insensitive);
 * (3) nameKey(). PURE.
 */
export function matchFirstToHub(
  first: FirstPerson[],
  hub: HubCandidate[],
): { pairs: { first: FirstPerson; personId: string }[]; unmatchedFirst: FirstPerson[] } {
  const claimed = new Set<string>();
  const pairs: { first: FirstPerson; personId: string }[] = [];
  const unmatchedFirst: FirstPerson[] = [];

  const byPeopleId = new Map<number, HubCandidate>();
  for (const c of hub) {
    if (c.firstPeopleId != null) byPeopleId.set(c.firstPeopleId, c);
  }

  for (const fp of first) {
    let match: HubCandidate | undefined;

    match = byPeopleId.get(fp.peopleId);
    if (match && claimed.has(match.personId)) match = undefined;

    if (!match) {
      match = hub.find(
        (c) => !claimed.has(c.personId) && c.emails.some((e) => e.toLowerCase() === fp.email),
      );
    }

    if (!match) {
      const key = nameKey(fp.firstName, fp.lastName);
      match = hub.find((c) => !claimed.has(c.personId) && nameKey(c.firstName, c.lastName) === key);
    }

    if (match) {
      claimed.add(match.personId);
      pairs.push({ first: fp, personId: match.personId });
    } else {
      unmatchedFirst.push(fp);
    }
  }

  return { pairs, unmatchedFirst };
}

type PersonForMatch = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  email: string | null;
  first_people_id: number | null;
};

export async function syncFirstRoster(deps: {
  db: SupabaseClient;
  fetchFn?: typeof fetch;
}): Promise<FirstSyncReport> {
  const { db } = deps;
  const fetchFn = deps.fetchFn ?? fetch;

  const teamProfileId = String(await getSetting<string | number | null>("first_team_profile_id", null, db));
  const session = await getSetting<{ cookie: string; savedAt: string } | null>("first_session", null, db);
  if (session == null) {
    throw new Error("first_not_configured");
  }

  const rosterUrl = `https://my.firstinspires.org/Teams/Page/TeamContacts/TeamRoster?TeamProfileID=${teamProfileId}`;
  const rosterRes = await fetchWithSession(rosterUrl, session.cookie, fetchFn);
  if (rosterRes.kind === "auth") {
    throw new Error("first_session_expired");
  }

  const model = parseTeamContactsModel(rosterRes.body);
  const adults = adultsFromModel(model);

  const statusRes = await fetchWithSession(
    statusUrl(teamProfileId, adults.map((p) => p.peopleId)),
    session.cookie,
    fetchFn,
  );
  if (statusRes.kind === "auth") {
    throw new Error("first_session_expired");
  }
  const statuses = JSON.parse(statusRes.body) as {
    peopleId: number;
    screening?: { status?: string | null; text?: string | null };
    training?: { status?: string | null };
  }[];
  const statusById = new Map(statuses.map((s) => [s.peopleId, s]));
  for (const adult of adults) {
    const status = statusById.get(adult.peopleId);
    adult.screeningStatus = status?.screening?.status ?? null;
    adult.screeningText = status?.screening?.text ?? null;
    adult.trainingStatus = status?.training?.status ?? null;
  }

  const { data: personRows, error: personError } = await db
    .from("person")
    .select("id, first_name, last_name, display_name, role, is_active, email, first_people_id")
    .in("role", ["mentor", "admin"]);
  if (personError) throw new Error(`first-sync: failed to load person rows: ${personError.message}`);
  const people = (personRows ?? []) as PersonForMatch[];

  const { data: identityRows, error: identityError } = await db
    .from("person_identity")
    .select("person_id, email");
  if (identityError) throw new Error(`first-sync: failed to load person_identity rows: ${identityError.message}`);
  const identities = (identityRows ?? []) as { person_id: string; email: string }[];
  const emailsByPerson = new Map<string, string[]>();
  for (const row of identities) {
    const list = emailsByPerson.get(row.person_id) ?? [];
    list.push(row.email);
    emailsByPerson.set(row.person_id, list);
  }

  const hub: HubCandidate[] = people.map((p) => ({
    personId: p.id,
    name: p.display_name ?? `${p.first_name} ${p.last_name}`,
    firstName: p.first_name,
    lastName: p.last_name,
    firstPeopleId: p.first_people_id,
    emails: [...(p.email ? [p.email] : []), ...(emailsByPerson.get(p.id) ?? [])],
  }));

  const { pairs, unmatchedFirst } = matchFirstToHub(adults, hub);

  const ranAt = new Date().toISOString();
  let updated = 0;
  for (const { first: fp, personId } of pairs) {
    const { error } = await db
      .from("person")
      .update({
        first_people_id: fp.peopleId,
        first_consent_release: fp.consentRelease,
        first_screening_status: fp.screeningStatus,
        first_screening_text: fp.screeningText,
        first_training_status: fp.trainingStatus,
        first_synced_at: ranAt,
      })
      .eq("id", personId);
    if (error) throw new Error(`first-sync: failed to update person ${personId}: ${error.message}`);
    updated++;
  }

  const matchedPersonIds = new Set(pairs.map((p) => p.personId));
  const unmatchedHub = people
    .filter((p) => p.is_active && !matchedPersonIds.has(p.id) && p.first_people_id == null)
    .map((p) => ({ personId: p.id, name: p.display_name ?? `${p.first_name} ${p.last_name}` }));

  const report: FirstSyncReport = {
    ranAt,
    rosterCount: adults.length,
    matched: pairs.length,
    updated,
    unmatchedFirst: unmatchedFirst.map((fp) => ({
      peopleId: fp.peopleId,
      name: `${fp.firstName} ${fp.lastName}`,
      email: fp.email,
    })),
    unmatchedHub,
  };

  await db.from("app_setting").upsert({ key: "first_last_sync_report", value: report }, { onConflict: "key" });

  return report;
}

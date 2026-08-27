import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlackDeps } from "./slack";

const API = "https://slack.com/api/";

export type SlackMember = { id: string; email: string };

type RawMember = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  profile?: { email?: string | null };
  // Slack sets is_email_confirmed on the member; treat missing as confirmed.
  is_email_confirmed?: boolean;
};

/** Fetch active human members with confirmed emails, following pagination. */
export async function fetchSlackMembers(deps: SlackDeps): Promise<SlackMember[]> {
  if (!deps.token) return [];
  const out: SlackMember[] = [];
  let cursor = "";
  do {
    const url = `${API}users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${deps.token}` } });
    const body = (await res.json()) as {
      ok: boolean;
      members?: RawMember[];
      response_metadata?: { next_cursor?: string };
    };
    if (!body.ok) throw new Error(`slack users.list failed: ${JSON.stringify(body)}`);
    for (const m of body.members ?? []) {
      if (m.deleted || m.is_bot || m.is_restricted || m.is_ultra_restricted) continue;
      if (m.is_email_confirmed === false) continue;
      const email = m.profile?.email?.trim().toLowerCase();
      if (!email) continue;
      out.push({ id: m.id, email });
    }
    cursor = body.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return out;
}

/**
 * Match Slack members to hub people by email (person.email + person_identity.email,
 * case-insensitive) and write person.slack_user_id on unambiguous matches.
 * Emails resolving to more than one person are reported, not written.
 */
export async function syncSlackLinks(deps: { db: SupabaseClient; slack: SlackDeps }): Promise<LinkReport> {
  const { db } = deps;
  const members = await fetchSlackMembers(deps.slack);

  const { data: personRows, error: pErr } = await db
    .from("person")
    .select("id, first_name, last_name, display_name, email, slack_user_id, is_active");
  if (pErr) throw new Error(`slack-link: load person failed: ${pErr.message}`);
  const people = (personRows ?? []) as {
    id: string; first_name: string; last_name: string; display_name: string | null;
    email: string | null; slack_user_id: string | null; is_active: boolean;
  }[];

  const { data: identRows, error: iErr } = await db.from("person_identity").select("person_id, email");
  if (iErr) throw new Error(`slack-link: load person_identity failed: ${iErr.message}`);

  // email(lowercase) -> set of personIds
  const byEmail = new Map<string, Set<string>>();
  const add = (email: string | null | undefined, personId: string) => {
    if (!email) return;
    const key = email.trim().toLowerCase();
    (byEmail.get(key) ?? byEmail.set(key, new Set()).get(key)!).add(personId);
  };
  for (const p of people) add(p.email, p.id);
  for (const row of (identRows ?? []) as { person_id: string; email: string }[]) add(row.email, row.person_id);

  const linkedByPerson = new Map(people.map((p) => [p.id, p.slack_user_id]));
  const report: LinkReport = { linked: 0, alreadyLinked: 0, ambiguous: [], unmatchedSlack: [], unmatchedPeople: [] };
  const matchedPeople = new Set<string>();

  for (const m of members) {
    const ids = byEmail.get(m.email);
    if (!ids || ids.size === 0) { report.unmatchedSlack.push(m); continue; }
    if (ids.size > 1) { report.ambiguous.push({ email: m.email, personIds: [...ids] }); continue; }
    const personId = [...ids][0];
    matchedPeople.add(personId);
    if (linkedByPerson.get(personId) === m.id) { report.alreadyLinked++; continue; }
    const { error } = await db.from("person").update({ slack_user_id: m.id }).eq("id", personId);
    if (error) throw new Error(`slack-link: update ${personId} failed: ${error.message}`);
    report.linked++;
  }

  report.unmatchedPeople = people
    .filter((p) => p.is_active && !p.slack_user_id && !matchedPeople.has(p.id))
    .map((p) => ({ personId: p.id, name: p.display_name ?? `${p.first_name} ${p.last_name}` }));

  return report;
}

export type LinkReport = {
  linked: number;
  alreadyLinked: number;
  ambiguous: { email: string; personIds: string[] }[];
  unmatchedSlack: SlackMember[];
  unmatchedPeople: { personId: string; name: string }[];
};

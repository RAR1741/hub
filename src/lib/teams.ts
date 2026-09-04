import type { SupabaseClient } from "@supabase/supabase-js";
import type { JoinMode, Team, TeamRow } from "./types";
import { teamFromRow } from "./types";
import { displayName } from "./people";
import { optString, reqString } from "./validate";
import { syncMembershipChange } from "./membership-sync";

export type TeamNode = Team & { children: TeamNode[] };

/** Build the display tree. PURE. Orphans become roots; siblings sort by name. */
export function buildTeamTree(teams: Team[]): TeamNode[] {
  const nodes = new Map<string, TeamNode>(
    teams.map((t) => [t.id, { ...t, children: [] }]),
  );
  const roots: TeamNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentTeamId ? nodes.get(node.parentTeamId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: TeamNode, b: TeamNode) => a.name.localeCompare(b.name);
  const sortRec = (list: TeamNode[]) => {
    list.sort(byName);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

const JOIN_MODES: JoinMode[] = ["admin_only", "open", "requires_approval"];

export type TeamInput = {
  name: string;
  parentTeamId: string | null;
  description: string | null;
  joinMode: JoinMode;
  googleGroupEmail: string | null;
  githubTeamSlug: string | null;
  slackChannels: { channelId: string; label: string | null }[];
};

const GITHUB_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{2,20}$/;

/** Validate the slackChannels array. PURE. Null = invalid, dedupes by channelId. */
function parseSlackChannels(v: unknown): { channelId: string; label: string | null }[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const result: { channelId: string; label: string | null }[] = [];
  for (const entry of v) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.channelId !== "string" || !SLACK_CHANNEL_ID_RE.test(e.channelId)) return null;
    const label = optString(e.label, 80);
    if (!label) return null;
    if (seen.has(e.channelId)) continue;
    seen.add(e.channelId);
    result.push({ channelId: e.channelId, label: label.value });
  }
  return result;
}

/** Validate a team payload. PURE. Null = invalid. */
export function parseTeamInput(body: unknown): TeamInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  const parentTeamId = optString(b.parentTeamId, 64);
  const description = optString(b.description, 500);
  const googleGroupEmail = optString(b.googleGroupEmail, 254);
  const githubTeamSlugRaw = optString(b.githubTeamSlug, 100);
  const joinMode = JOIN_MODES.find((m) => m === b.joinMode);
  const slackChannels = parseSlackChannels(b.slackChannels);
  if (!name || !parentTeamId || !description || !googleGroupEmail || !githubTeamSlugRaw || !joinMode || !slackChannels) return null;
  const githubTeamSlug = githubTeamSlugRaw.value ? githubTeamSlugRaw.value.toLowerCase() : null;
  if (githubTeamSlug && !GITHUB_SLUG_RE.test(githubTeamSlug)) return null;
  return {
    name,
    parentTeamId: parentTeamId.value,
    description: description.value,
    joinMode,
    googleGroupEmail: googleGroupEmail.value,
    githubTeamSlug,
    slackChannels,
  };
}

const UNIQUE_VIOLATION = "23505";

export async function listTeamSlackChannels(
  teamId: string,
  db?: SupabaseClient,
): Promise<{ channelId: string; label: string | null }[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("team_slack_channel")
    .select("slack_channel_id, label")
    .eq("team_id", teamId)
    .order("slack_channel_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    channelId: r.slack_channel_id as string,
    label: r.label as string | null,
  }));
}

/** Delete-then-insert, non-transactional. `team_slack_channel` is
 *  source-of-truth team config (like `team_external_account`), not a
 *  best-effort Slack side effect — on failure we log and return false so the
 *  caller reports a failed save rather than silently losing channel links. */
async function replaceTeamSlackChannels(
  client: SupabaseClient,
  teamId: string,
  channels: { channelId: string; label: string | null }[],
): Promise<boolean> {
  const { error: deleteError } = await client.from("team_slack_channel").delete().eq("team_id", teamId);
  if (deleteError) {
    console.error("replaceTeamSlackChannels: delete failed", deleteError);
    return false;
  }
  if (channels.length === 0) return true;
  const { error: insertError } = await client.from("team_slack_channel").insert(
    channels.map((c) => ({ team_id: teamId, slack_channel_id: c.channelId, label: c.label })),
  );
  if (insertError) {
    console.error("replaceTeamSlackChannels: insert failed", insertError);
    return false;
  }
  return true;
}

export async function listTeams(db?: SupabaseClient): Promise<Team[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("team").select("*").order("name");
  return ((data ?? []) as TeamRow[]).map(teamFromRow);
}

export async function getTeam(id: string, db?: SupabaseClient): Promise<Team | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("team").select("*").eq("id", id).maybeSingle();
  return data ? teamFromRow(data as TeamRow) : null;
}

export async function createTeam(
  input: TeamInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("team")
    .insert({
      name: input.name,
      parent_team_id: input.parentTeamId,
      description: input.description,
      join_mode: input.joinMode,
      google_group_email: input.googleGroupEmail,
      github_team_slug: input.githubTeamSlug,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  const channelsOk = await replaceTeamSlackChannels(client, data.id as string, input.slackChannels);
  if (!channelsOk) return { ok: false, status: 500 };
  return { ok: true, id: data.id as string };
}

export async function updateTeam(
  id: string,
  input: TeamInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  if (input.parentTeamId === id) return { ok: false, status: 400 }; // no self-parenting
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("team")
    .update({
      name: input.name,
      parent_team_id: input.parentTeamId,
      description: input.description,
      join_mode: input.joinMode,
      google_group_email: input.googleGroupEmail,
      github_team_slug: input.githubTeamSlug,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  if (!data) return { ok: false, status: 404 };
  const channelsOk = await replaceTeamSlackChannels(client, id, input.slackChannels);
  if (!channelsOk) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

/** Refuses to delete a team that still has children or members (409). */
export async function deleteTeam(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const [{ count: children }, { count: members }] = await Promise.all([
    client.from("team").select("id", { count: "exact", head: true }).eq("parent_team_id", id),
    client.from("team_membership").select("team_id", { count: "exact", head: true }).eq("team_id", id),
  ]);
  if ((children ?? 0) > 0 || (members ?? 0) > 0) return { ok: false, status: 409 };
  const { error } = await client.from("team").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function listTeamMembers(
  teamId: string,
  db?: SupabaseClient,
): Promise<{ personId: string; name: string; isManager: boolean }[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("team_membership")
    .select("is_manager, person (id, first_name, last_name, display_name)")
    .eq("team_id", teamId);
  return (data ?? [])
    .filter((m) => m.person)
    .map((m) => {
      const p = m.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      return { personId: p.id, name: displayName(p), isManager: m.is_manager as boolean };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertMember(
  teamId: string,
  personId: string,
  isManager: boolean,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("team_membership")
    .upsert(
      { team_id: teamId, person_id: personId, is_manager: isManager },
      { onConflict: "person_id,team_id" },
    );
  if (error) return { ok: false, status: 500 };
  await syncMembershipChange("add", teamId, personId, client);
  return { ok: true, status: 200 };
}

export async function removeMember(
  teamId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("team_membership")
    .delete()
    .eq("team_id", teamId)
    .eq("person_id", personId);
  if (error) return { ok: false, status: 500 };
  await syncMembershipChange("remove", teamId, personId, client);
  return { ok: true, status: 200 };
}

export type JoinActionResult = "member" | "join" | "apply" | "pending" | "none";

/** What the teams page offers this person for this team. PURE. */
export function joinAction(
  team: Team,
  isMember: boolean,
  hasPendingApplication: boolean,
): JoinActionResult {
  if (isMember) return "member";
  if (team.joinMode === "open") return "join";
  if (team.joinMode === "requires_approval") {
    return hasPendingApplication ? "pending" : "apply";
  }
  return "none";
}

export async function memberTeamIds(
  personId: string,
  db?: SupabaseClient,
): Promise<Set<string>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("team_membership")
    .select("team_id")
    .eq("person_id", personId);
  return new Set((data ?? []).map((r) => r.team_id as string));
}

/** Direct-member counts per team. ONE query + JS aggregation — avoids the
 *  PostgREST embedded-count path, which has documented dual-FK (PGRST201)
 *  problems against team_membership. Missing team → 0 via `?? 0` at call sites. */
export async function teamMemberCounts(db?: SupabaseClient): Promise<Map<string, number>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("team_membership").select("team_id");
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const teamId = row.team_id as string;
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return counts;
}

export async function pendingApplicationTeamIds(
  personId: string,
  db?: SupabaseClient,
): Promise<Set<string>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("membership_application")
    .select("team_id")
    .eq("person_id", personId)
    .eq("status", "pending");
  return new Set((data ?? []).map((r) => r.team_id as string));
}

/** Self-service join — server-side re-check that the team really is open. */
export async function joinTeam(
  teamId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const team = await getTeam(teamId, client);
  if (!team) return { ok: false, status: 404 };
  if (team.joinMode !== "open") return { ok: false, status: 403 };
  const { error } = await client
    .from("team_membership")
    .upsert(
      { team_id: teamId, person_id: personId, is_manager: false },
      { onConflict: "person_id,team_id" },
    );
  if (error) return { ok: false, status: 500 };
  await syncMembershipChange("add", teamId, personId, client);
  return { ok: true, status: 200 };
}

const UNIQUE_VIOLATION_APPLY = "23505";

/** Self-service application — one pending application per (person, team). */
export async function applyToTeam(
  teamId: string,
  personId: string,
  message: string | null,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const team = await getTeam(teamId, client);
  if (!team) return { ok: false, status: 404 };
  if (team.joinMode !== "requires_approval") return { ok: false, status: 403 };
  const { error } = await client.from("membership_application").insert({
    team_id: teamId,
    person_id: personId,
    message,
  });
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION_APPLY ? 409 : 500 };
  }
  return { ok: true, status: 200 };
}

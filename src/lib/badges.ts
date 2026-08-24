import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "./people";
import { memberTeamIds } from "./teams";
import type { Badge, BadgeRow, Role } from "./types";
import { badgeFromRow } from "./types";
import { hasRole } from "./authz";
import { optString, reqString, reqUuid } from "./validate";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export type BadgeInput = {
  name: string;
  category: string | null;
  description: string | null;
  color: string;
  teamId: string | null;
  allowSelfAward: boolean;
};

/** Validate an admin badge-definition payload. PURE. Null = invalid. */
export function parseBadgeInput(body: unknown): BadgeInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  const category = optString(b.category, 80);
  const description = optString(b.description, 500);
  const teamId = optString(b.teamId, 64);
  const color = typeof b.color === "string" && HEX_COLOR.test(b.color) ? b.color : null;
  if (!name || !category || !description || !teamId || !color) return null;
  if (typeof b.allowSelfAward !== "boolean") return null;
  return {
    name,
    category: category.value,
    description: description.value,
    color,
    teamId: teamId.value,
    allowSelfAward: b.allowSelfAward,
  };
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

export async function listBadges(db?: SupabaseClient): Promise<Badge[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("badge").select("*").order("name");
  return ((data ?? []) as BadgeRow[]).map(badgeFromRow);
}

export async function getBadge(id: string, db?: SupabaseClient): Promise<Badge | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("badge").select("*").eq("id", id).maybeSingle();
  return data ? badgeFromRow(data as BadgeRow) : null;
}

export async function createBadge(
  input: BadgeInput,
  createdBy: string,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("badge")
    .insert({
      name: input.name,
      category: input.category,
      description: input.description,
      color: input.color,
      team_id: input.teamId,
      allow_self_award: input.allowSelfAward,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  return { ok: true, id: data.id as string };
}

export async function updateBadge(
  id: string,
  input: BadgeInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("badge")
    .update({
      name: input.name,
      category: input.category,
      description: input.description,
      color: input.color,
      team_id: input.teamId,
      allow_self_award: input.allowSelfAward,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export async function deleteBadge(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client.from("badge").delete().eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

export type AwardedBadge = Badge & {
  awardId: string;
  awardedBy: string;
  awardedByName: string;
  awardedAt: string;
  note: string | null;
};

/**
 * Badges a person holds, newest award first, with the awarder's display
 * name. Uses the `person!awarded_by` FK-hint embed — badge_award has two
 * person FKs (person_id + awarded_by), so an unqualified embed is ambiguous
 * and PostgREST rejects it with PGRST201 (mirrors excusal-requests.ts).
 */
export async function listBadgesForPerson(
  personId: string,
  db?: SupabaseClient,
): Promise<AwardedBadge[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("badge_award")
    .select("id, note, awarded_at, badge (*), awarder:person!awarded_by (id, first_name, last_name, display_name)")
    .eq("person_id", personId)
    .order("awarded_at", { ascending: false });
  if (error) console.error("listBadgesForPerson: query failed", error);
  return (data ?? [])
    .filter((r) => r.badge && r.awarder)
    .map((r) => {
      const badge = r.badge as unknown as BadgeRow;
      const awarder = r.awarder as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        display_name: string | null;
      };
      return {
        ...badgeFromRow(badge),
        awardId: r.id as string,
        awardedBy: awarder.id,
        awardedByName: displayName(awarder),
        awardedAt: r.awarded_at as string,
        note: r.note as string | null,
      };
    });
}

/** Whether `viewer` may award `badge` to `personId`. PURE. */
export function canAwardBadge(
  viewerRole: Role,
  viewerPersonId: string | null,
  personId: string,
  badge: Badge,
): boolean {
  if (hasRole(viewerRole, "mentor")) return true;
  return viewerPersonId === personId && badge.allowSelfAward;
}

/** Badges `personId` doesn't already hold that `viewer` is allowed to award. */
export async function listAwardableBadges(
  personId: string,
  viewerRole: Role,
  viewerPersonId: string | null,
  db?: SupabaseClient,
): Promise<Badge[]> {
  const client = db ?? (await import("./db")).getDb();
  const [all, held, memberOf] = await Promise.all([
    listBadges(client),
    client.from("badge_award").select("badge_id").eq("person_id", personId),
    memberTeamIds(personId, client),
  ]);
  const heldIds = new Set((held.data ?? []).map((r) => r.badge_id as string));
  return all.filter(
    (badge) =>
      !heldIds.has(badge.id) &&
      canAwardBadge(viewerRole, viewerPersonId, personId, badge) &&
      (badge.teamId === null || memberOf.has(badge.teamId)),
  );
}

export type AwardBadgeInput = { badgeId: string; note: string | null };

/** Validate an award-badge payload. PURE. Null = invalid. */
export function parseAwardBadgeInput(body: unknown): AwardBadgeInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const badgeId = reqUuid(b.badgeId);
  const note = optString(b.note, 300);
  if (!badgeId || !note) return null;
  return { badgeId, note: note.value };
}

export async function awardBadge(
  badgeId: string,
  personId: string,
  awardedBy: string,
  note: string | null,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: badge } = await client
    .from("badge")
    .select("team_id")
    .eq("id", badgeId)
    .maybeSingle();
  if (!badge) return { ok: false, status: 404 };
  const badgeRow = badge as { team_id: string | null };
  const teamId = badgeRow.team_id;
  if (teamId) {
    const { data: membership } = await client
      .from("team_membership")
      .select("team_id")
      .eq("team_id", teamId)
      .eq("person_id", personId)
      .maybeSingle();
    if (!membership) return { ok: false, status: 409 };
  }
  const { error } = await client.from("badge_award").insert({
    badge_id: badgeId,
    person_id: personId,
    awarded_by: awardedBy,
    note,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, status: 409 };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, status: 404 };
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 201 };
}

export async function revokeBadgeAward(
  badgeId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("badge_award")
    .delete()
    .eq("badge_id", badgeId)
    .eq("person_id", personId)
    .select("id");
  if (error) return { ok: false, status: 500 };
  if (!data || data.length === 0) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

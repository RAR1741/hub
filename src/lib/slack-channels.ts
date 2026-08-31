import type { SupabaseClient } from "@supabase/supabase-js";
import { slackDepsFromEnv, type SlackDeps } from "./slack";

const API = "https://slack.com/api/";

/**
 * Derive the two candidate Slack channel names for an event. `base` is tried
 * first; `suffixed` is the deterministic fallback on a `name_taken` collision
 * (e.g. an archived channel from a prior season keeping the same name).
 * PURE — no I/O.
 */
export function channelSlug(name: string, eventId: string): { base: string; suffixed: string } {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s === "") s = eventId.slice(0, 8);
  const slug = `e-${s}`;
  return {
    base: slug.slice(0, 80),
    suffixed: `${slug.slice(0, 75)}-${eventId.slice(0, 4)}`,
  };
}

/** Module-local copy of slack.ts's private post() — kept local so that file's exported signatures stay untouched. */
async function post(deps: SlackDeps, method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await deps.fetch(`${API}${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && body.ok === true, body };
}

/** Create the event's Slack channel, trying `base` then `suffixed` on a `name_taken` collision. */
export async function createEventChannel(deps: SlackDeps, name: string, eventId: string): Promise<{ id: string; name: string } | null> {
  const { base, suffixed } = channelSlug(name, eventId);
  if (!deps.token) {
    console.log(`[slack:no-token] would create channel ${base}`);
    return null;
  }
  if (!deps.isProd) {
    console.log(`[slack:dev] would create channel ${base}`);
    return null;
  }
  try {
    let { ok, body } = await post(deps, "conversations.create", { name: base, is_private: false });
    let chosen = base;
    if (!ok && body.error === "name_taken") {
      chosen = suffixed;
      ({ ok, body } = await post(deps, "conversations.create", { name: suffixed, is_private: false }));
    }
    if (!ok) {
      console.error(`[slack] conversations.create failed:`, body.error ?? body);
      return null;
    }
    const id = (body.channel as { id?: string } | undefined)?.id;
    if (!id) return null;
    return { id, name: chosen };
  } catch (e) {
    console.error(`[slack] conversations.create threw:`, e);
    return null;
  }
}

/** Rename a channel, trying `base` then `suffixed` on a `name_taken` collision. */
export async function renameChannel(deps: SlackDeps, channelId: string, name: string, eventId: string): Promise<{ name: string } | null> {
  const { base, suffixed } = channelSlug(name, eventId);
  if (!deps.token) {
    console.log(`[slack:no-token] would rename ${channelId} to ${base}`);
    return null;
  }
  if (!deps.isProd) {
    console.log(`[slack:dev] would rename ${channelId} to ${base}`);
    return null;
  }
  try {
    let { ok, body } = await post(deps, "conversations.rename", { channel: channelId, name: base });
    let chosen = base;
    if (!ok && body.error === "name_taken") {
      chosen = suffixed;
      ({ ok, body } = await post(deps, "conversations.rename", { channel: channelId, name: suffixed }));
    }
    if (!ok) {
      console.error(`[slack] conversations.rename failed:`, body.error ?? body);
      return null;
    }
    return { name: chosen };
  } catch (e) {
    console.error(`[slack] conversations.rename threw:`, e);
    return null;
  }
}

/** Archive a channel. `already_archived` counts as success (idempotent). */
export async function archiveChannel(deps: SlackDeps, channelId: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would archive ${channelId}`);
    return false;
  }
  if (!deps.isProd) {
    console.log(`[slack:dev] would archive ${channelId}`);
    return false;
  }
  try {
    const { ok, body } = await post(deps, "conversations.archive", { channel: channelId });
    if (!ok && body.error !== "already_archived") {
      console.error(`[slack] conversations.archive failed:`, body.error ?? body);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[slack] conversations.archive threw:`, e);
    return false;
  }
}

/** Invite Slack users to a channel. `already_in_channel` counts as success. */
export async function inviteToChannel(deps: SlackDeps, channelId: string, slackUserIds: string[]): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would invite ${slackUserIds.join(",")} to ${channelId}`);
    return false;
  }
  if (!deps.isProd) {
    console.log(`[slack:dev] would invite ${slackUserIds.join(",")} to ${channelId}`);
    return false;
  }
  try {
    const { ok, body } = await post(deps, "conversations.invite", { channel: channelId, users: slackUserIds.join(",") });
    if (!ok && body.error !== "already_in_channel") {
      console.error(`[slack] conversations.invite failed:`, body.error ?? body);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[slack] conversations.invite threw:`, e);
    return false;
  }
}

/** Post the kickoff message to an event's channel. */
export async function postToEventChannel(deps: SlackDeps, channelId: string, text: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would post to ${channelId}: ${text}`);
    return false;
  }
  if (!deps.isProd) {
    console.log(`[slack:dev] would post to ${channelId}: ${text}`);
    return false;
  }
  try {
    const { ok, body } = await post(deps, "chat.postMessage", { channel: channelId, text });
    if (!ok) console.error(`[slack] chat.postMessage failed:`, body.error ?? body);
    return ok;
  } catch (e) {
    console.error(`[slack] chat.postMessage threw:`, e);
    return false;
  }
}

// --- Orchestrators: own the DB writes that record outcomes. Never throw —
// each is wrapped so a Slack failure can never change the event/signup
// mutation's result (matches events.ts/event-signups.ts's degrade-and-log
// convention). Not yet wired into createEvent/updateEvent/signUpForEvent —
// that's a separate task.

export type EventCreatedInput = {
  id: string;
  name: string; // effective (resolved) name — NOT raw input for gcal-linked events
  createdBy: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
};

/** Create the event's channel, persist it, invite the creator (if linked), post a kickoff message. */
export async function afterEventCreated(deps: { db: SupabaseClient; slack?: SlackDeps }, ev: EventCreatedInput): Promise<void> {
  const slack = deps.slack ?? slackDepsFromEnv();
  try {
    const channel = await createEventChannel(slack, ev.name, ev.id);
    if (!channel) return;
    const { error } = await deps.db
      .from("event")
      .update({ slack_channel_id: channel.id, slack_channel_name: channel.name })
      .eq("id", ev.id);
    if (error) {
      console.error("afterEventCreated: persisting channel id/name failed:", error);
      return;
    }
    const { data: creator } = await deps.db.from("person").select("slack_user_id").eq("id", ev.createdBy).maybeSingle();
    const creatorSlackId = (creator as { slack_user_id?: string | null } | null)?.slack_user_id ?? null;
    if (creatorSlackId) await inviteToChannel(slack, channel.id, [creatorSlackId]);
    const where = ev.location ? ` at ${ev.location}` : "";
    await postToEventChannel(slack, channel.id, `:tada: *${ev.name}* — ${ev.startsAt} to ${ev.endsAt}${where}`);
  } catch (e) {
    console.error("afterEventCreated threw:", e);
  }
}

export type EventUpdatedInput = {
  id: string;
  name: string; // effective (resolved) name
  slackChannelId: string | null;
  slackChannelName: string | null;
  slackArchivedAt: string | null;
};

/** Rename the event's channel when its effective name no longer matches either stored candidate. No-op if unchanneled/archived. */
export async function afterEventUpdated(deps: { db: SupabaseClient; slack?: SlackDeps }, ev: EventUpdatedInput): Promise<void> {
  if (!ev.slackChannelId || ev.slackArchivedAt) return;
  const slack = deps.slack ?? slackDepsFromEnv();
  try {
    const { base, suffixed } = channelSlug(ev.name, ev.id);
    if (ev.slackChannelName === base || ev.slackChannelName === suffixed) return;
    const renamed = await renameChannel(slack, ev.slackChannelId, ev.name, ev.id);
    if (!renamed) return;
    const { error } = await deps.db.from("event").update({ slack_channel_name: renamed.name }).eq("id", ev.id);
    if (error) console.error("afterEventUpdated: persisting renamed channel name failed:", error);
  } catch (e) {
    console.error("afterEventUpdated threw:", e);
  }
}

export type EventSignupInput = { id: string; slackChannelId: string | null; slackArchivedAt: string | null };

/** Invite a signup if they're linked; unlinked is a silent no-op — the null slack_invited_at IS the admin record. */
export async function afterEventSignup(deps: { db: SupabaseClient; slack?: SlackDeps }, ev: EventSignupInput, personId: string): Promise<void> {
  if (!ev.slackChannelId || ev.slackArchivedAt) return;
  const slack = deps.slack ?? slackDepsFromEnv();
  try {
    const { data: person } = await deps.db.from("person").select("slack_user_id").eq("id", personId).maybeSingle();
    const slackUserId = (person as { slack_user_id?: string | null } | null)?.slack_user_id ?? null;
    if (!slackUserId) return;
    const ok = await inviteToChannel(slack, ev.slackChannelId, [slackUserId]);
    if (!ok) return;
    const { error } = await deps.db
      .from("event_signup")
      .update({ slack_invited_at: new Date().toISOString() })
      .eq("event_id", ev.id)
      .eq("person_id", personId);
    if (error) console.error("afterEventSignup: persisting slack_invited_at failed:", error);
  } catch (e) {
    console.error("afterEventSignup threw:", e);
  }
}

type SweepEventRow = { id: string; name: string; ends_at: string; slack_channel_id: string; slack_channel_name: string | null };
type SweepSignupRow = { event_id: string; person_id: string; person: { slack_user_id: string | null } | null };

export type SweepSummary = { archived: number; renamed: number; invited: number; failed: number };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nightly reconciler (idempotent — every step safe to re-run): archives
 * channels for events that ended >7 days ago, heals channel names drifted
 * from the effective event name (incl. calendar-sync renames), and retries
 * invites for signups that were never successfully invited.
 */
export async function sweepEventChannels(deps: { db: SupabaseClient; slack?: SlackDeps; sleep?: (ms: number) => Promise<void> }): Promise<SweepSummary> {
  const slack = deps.slack ?? slackDepsFromEnv();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const summary: SweepSummary = { archived: 0, renamed: 0, invited: 0, failed: 0 };

  const { data, error } = await deps.db
    .from("event")
    .select("id, name, ends_at, slack_channel_id, slack_channel_name")
    .not("slack_channel_id", "is", null)
    .is("slack_archived_at", null);
  if (error) {
    console.error("sweepEventChannels: loading channeled events failed:", error);
    return summary;
  }

  const events = (data ?? []) as SweepEventRow[];
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const surviving: SweepEventRow[] = [];

  for (const ev of events) {
    if (Date.parse(ev.ends_at) < cutoff) {
      const archivedOk = await archiveChannel(slack, ev.slack_channel_id);
      if (!archivedOk) {
        summary.failed++;
        continue;
      }
      const { error: archErr } = await deps.db.from("event").update({ slack_archived_at: new Date().toISOString() }).eq("id", ev.id);
      if (archErr) {
        console.error("sweepEventChannels: persisting slack_archived_at failed:", archErr);
        summary.failed++;
      } else {
        summary.archived++;
      }
      continue; // archived events don't also get rename/invite passes
    }
    surviving.push(ev);
  }

  for (const ev of surviving) {
    const { base, suffixed } = channelSlug(ev.name, ev.id);
    if (ev.slack_channel_name === base || ev.slack_channel_name === suffixed) continue;
    const renamed = await renameChannel(slack, ev.slack_channel_id, ev.name, ev.id);
    if (!renamed) {
      summary.failed++;
      continue;
    }
    const { error: renErr } = await deps.db.from("event").update({ slack_channel_name: renamed.name }).eq("id", ev.id);
    if (renErr) {
      console.error("sweepEventChannels: persisting renamed channel name failed:", renErr);
      summary.failed++;
    } else {
      summary.renamed++;
    }
  }

  if (surviving.length > 0) {
    const channelByEvent = new Map(surviving.map((e) => [e.id, e.slack_channel_id]));
    const { data: signups, error: signupErr } = await deps.db
      .from("event_signup")
      .select("event_id, person_id, person(slack_user_id)")
      .in("event_id", surviving.map((e) => e.id))
      .is("slack_invited_at", null);
    if (signupErr) {
      console.error("sweepEventChannels: loading uninvited signups failed:", signupErr);
    } else {
      for (const s of (signups ?? []) as unknown as SweepSignupRow[]) {
        const slackUserId = s.person?.slack_user_id ?? null;
        const channelId = channelByEvent.get(s.event_id);
        if (!slackUserId || !channelId) continue; // still-unlinked stays null — that's the admin record
        const ok = await inviteToChannel(slack, channelId, [slackUserId]);
        if (ok) {
          const { error: invErr } = await deps.db
            .from("event_signup")
            .update({ slack_invited_at: new Date().toISOString() })
            .eq("event_id", s.event_id)
            .eq("person_id", s.person_id);
          if (invErr) {
            console.error("sweepEventChannels: persisting slack_invited_at failed:", invErr);
            summary.failed++;
          } else {
            summary.invited++;
          }
        } else {
          summary.failed++;
        }
        await sleep(1100); // ~1 invite/sec, mirrors mentor-reminders.ts
      }
    }
  }

  return summary;
}

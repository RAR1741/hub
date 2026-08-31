import type { SlackDeps } from "./slack";

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

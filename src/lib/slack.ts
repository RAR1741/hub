import { CHANNELS, type ChannelName } from "./slack-registry";

const API = "https://slack.com/api/";

export type SlackDeps = {
  fetch: typeof globalThis.fetch;
  token: string | null;
  isProd: boolean;
};

/** Bot token from env; null (⇒ sends become logged no-ops) when unset. */
export function slackTokenFromEnv(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

export function slackDepsFromEnv(): SlackDeps {
  return {
    fetch: globalThis.fetch,
    token: slackTokenFromEnv(),
    // Reserved, unforgeable. Any non-"production" value (preview/dev/unset) is non-prod.
    isProd: process.env.VERCEL_ENV === "production",
  };
}

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

/**
 * Post to a channel. In non-production every message is redirected to
 * #bot-test, prefixed with its intended destination — so a dev/preview build
 * can never reach a real channel even with a prod token. Never throws; logs
 * and returns false on any failure.
 */
export async function postChannelMessage(deps: SlackDeps, channel: ChannelName, text: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would post to ${channel}: ${text}`);
    return false;
  }
  const target = deps.isProd ? CHANNELS[channel] : CHANNELS.bot_test;
  const body = deps.isProd ? text : `[dev → #${channel}] ${text}`;
  try {
    const { ok, body: resBody } = await post(deps, "chat.postMessage", { channel: target, text: body });
    if (!ok) console.error(`[slack] chat.postMessage failed:`, resBody.error ?? resBody);
    return ok;
  } catch (e) {
    console.error(`[slack] chat.postMessage threw:`, e);
    return false;
  }
}

/**
 * DM a Slack user (conversations.open → chat.postMessage). In non-production
 * the message is routed to #bot-test instead of opening a real DM. Never
 * throws; returns false on failure.
 */
export async function sendDM(deps: SlackDeps, slackUserId: string, text: string): Promise<boolean> {
  if (!deps.token) {
    console.log(`[slack:no-token] would DM ${slackUserId}: ${text}`);
    return false;
  }
  if (!deps.isProd) {
    try {
      const { ok } = await post(deps, "chat.postMessage", {
        channel: CHANNELS.bot_test,
        text: `[dev → DM ${slackUserId}] ${text}`,
      });
      return ok;
    } catch (e) {
      console.error(`[slack] dev DM redirect threw:`, e);
      return false;
    }
  }
  try {
    const opened = await post(deps, "conversations.open", { users: slackUserId });
    if (!opened.ok) {
      console.error(`[slack] conversations.open failed:`, opened.body.error ?? opened.body);
      return false;
    }
    const channelId = (opened.body.channel as { id?: string } | undefined)?.id;
    if (!channelId) return false;
    const { ok, body } = await post(deps, "chat.postMessage", { channel: channelId, text });
    if (!ok) console.error(`[slack] DM post failed:`, body.error ?? body);
    return ok;
  } catch (e) {
    console.error(`[slack] sendDM threw:`, e);
    return false;
  }
}

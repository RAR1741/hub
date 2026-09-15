import type { SupabaseClient } from "@supabase/supabase-js";
import { postChannelMessage, type SlackDeps } from "./slack";
import { getSetting } from "./settings";
import {
  fetchInstallationToken,
  githubBaseHeaders,
  githubHeaders,
  type GithubAppCredentials,
  type GithubDeps,
} from "./github-app";

export type MergedPr = {
  number: number;
  title: string;
  htmlUrl: string;
  mergedAt: string; // ISO, from GitHub `merged_at`
  author: string; // GitHub `user.login`
  labels: string[]; // GitHub `labels[].name`
};

export type Window = { start: Date; end: Date };

export type WhatsNewDeps = {
  fetch: typeof globalThis.fetch;
  slack: SlackDeps;
  githubCredentials: GithubAppCredentials | null; // null ⇒ anonymous GitHub call
  db: SupabaseClient;
  now?: () => Date;
};

export const HEADS_UP_LABEL = "heads-up";

/** `app_setting` key holding the end of the last successfully posted window, as an ISO string. */
export const WHATS_NEW_CURSOR_KEY = "whats_new_cursor";

/** Longest gap one digest will cover; a longer outage is clipped (and says so). */
export const MAX_CATCHUP_MS = 21 * 24 * 60 * 60 * 1000;

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MAX_PAGES = 10;

type GithubPull = {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  updated_at: string;
  user: { login: string } | null;
  labels: { name: string }[];
};

/** GET merged PRs to master, filtered to `window`. Anonymous when no App creds. */
export async function fetchMergedPrs(deps: WhatsNewDeps, window: Window): Promise<MergedPr[]> {
  const owner = process.env.GITHUB_ORG ?? "RAR1741";

  let headers = githubBaseHeaders();
  if (deps.githubCredentials) {
    const githubDeps: GithubDeps = { fetch: deps.fetch, credentials: deps.githubCredentials, now: deps.now };
    try {
      const token = await fetchInstallationToken(githubDeps);
      headers = githubHeaders(token);
    } catch (e) {
      console.warn("whats-new: installation token exchange failed, falling back to anonymous", e);
    }
  }

  const start = window.start.toISOString();
  const end = window.end.toISOString();
  const merged: MergedPr[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${owner}/hub/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`;
    const res = await deps.fetch(url, { headers });
    if (!res.ok) throw new Error(`whats-new: list pulls failed: ${res.status}`);
    const pulls = (await res.json()) as GithubPull[];

    for (const p of pulls) {
      if (p.merged_at == null || p.merged_at < start || p.merged_at >= end) continue;
      merged.push({
        number: p.number,
        title: p.title,
        htmlUrl: p.html_url,
        mergedAt: p.merged_at,
        author: p.user?.login ?? "unknown",
        labels: p.labels.map((l) => l.name),
      });
    }

    // Merging bumps `updated_at`, so `merged_at <= updated_at`. Listed by `updated` descending,
    // once a page ends before the window nothing further down can still be in it.
    if (pulls.length < PER_PAGE || pulls[pulls.length - 1].updated_at < start) break;
  }

  return merged;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bullet(p: MergedPr): string {
  return `• <${p.htmlUrl}|${esc(p.title)}> (#${p.number}, @${p.author})`;
}

/** PURE. Renders the Slack mrkdwn digest, or null for an empty week. */
export function formatWhatsNew(prs: MergedPr[], window: Window, clipped = false): string | null {
  if (prs.length === 0) return null;
  const sorted = [...prs].sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
  const watchOut = sorted.filter((p) => p.labels.some((l) => l.toLowerCase() === HEADS_UP_LABEL));
  const rest = sorted.filter((p) => !watchOut.includes(p));

  const startDate = window.start.toISOString().slice(0, 10);
  const endDate = window.end.toISOString().slice(0, 10);
  const sections = [`*What's new in the hub* (${startDate} – ${endDate})`];

  if (watchOut.length > 0) {
    sections.push([":warning: *Watch out for*", ...watchOut.map(bullet)].join("\n"));
  }
  if (rest.length > 0) {
    sections.push(["*What's new*", ...rest.map(bullet)].join("\n"));
  }

  if (clipped) {
    const days = MAX_CATCHUP_MS / (24 * 60 * 60 * 1000);
    sections.push(`_Catch-up clipped to ${days} days — PRs merged before ${startDate} were not included._`);
  }

  return sections.join("\n\n");
}

/** Fetch, format, and post the window since the last posted digest, then advance the cursor. */
export async function sendWhatsNewDigest(
  deps: WhatsNewDeps,
): Promise<{ posted: boolean; count: number; clipped: boolean }> {
  const end = (deps.now ?? (() => new Date()))();
  const cursor = await getSetting<string>(WHATS_NEW_CURSOR_KEY, "", deps.db);
  const cursorMs = cursor.length > 0 ? new Date(cursor).getTime() : NaN;
  const from = Number.isNaN(cursorMs) ? end.getTime() - DEFAULT_LOOKBACK_MS : cursorMs;
  const clipped = end.getTime() - from > MAX_CATCHUP_MS;
  const window: Window = { start: new Date(clipped ? end.getTime() - MAX_CATCHUP_MS : from), end };

  const prs = await fetchMergedPrs(deps, window);
  const text = formatWhatsNew(prs, window, clipped);
  const posted = text === null ? false : await postChannelMessage(deps.slack, "hub-admin-alerts", text);

  // Advance only when the window is actually accounted for: an empty window is a success
  // ("nothing to say"), but a Slack post that didn't land must leave the cursor where it is so
  // the next run re-covers the gap. A throw above never reaches here, for the same reason.
  if (text === null || posted) {
    await deps.db
      .from("app_setting")
      .upsert({ key: WHATS_NEW_CURSOR_KEY, value: end.toISOString() }, { onConflict: "key" });
  }

  return { posted, count: prs.length, clipped };
}

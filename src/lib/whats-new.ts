import { postChannelMessage, type SlackDeps } from "./slack";
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
  now?: () => Date;
};

export const HEADS_UP_LABEL = "heads-up";

type GithubPull = {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
};

/** GET merged PRs to master, filtered to `window`. Anonymous when no App creds. */
export async function fetchMergedPrs(deps: WhatsNewDeps, window: Window): Promise<MergedPr[]> {
  const owner = process.env.GITHUB_ORG ?? "RAR1741";
  const url = `https://api.github.com/repos/${owner}/hub/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=100`;

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

  // ponytail: one page of 100; a week where >100 closed PRs get touched would drop
  // the oldest merges — add page=2 when that happens.
  const res = await deps.fetch(url, { headers });
  if (!res.ok) throw new Error(`whats-new: list pulls failed: ${res.status}`);
  const pulls = (await res.json()) as GithubPull[];

  const start = window.start.toISOString();
  const end = window.end.toISOString();
  return pulls
    .filter((p) => p.merged_at != null && p.merged_at >= start && p.merged_at < end)
    .map((p) => ({
      number: p.number,
      title: p.title,
      htmlUrl: p.html_url,
      mergedAt: p.merged_at as string,
      author: p.user?.login ?? "unknown",
      labels: p.labels.map((l) => l.name),
    }));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bullet(p: MergedPr): string {
  return `• <${p.htmlUrl}|${esc(p.title)}> (#${p.number}, @${p.author})`;
}

/** PURE. Renders the Slack mrkdwn digest, or null for an empty week. */
export function formatWhatsNew(prs: MergedPr[], window: Window): string | null {
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

  return sections.join("\n\n");
}

/** Compute the trailing 7-day window, fetch, format, and post. */
export async function sendWhatsNewDigest(deps: WhatsNewDeps): Promise<{ posted: boolean; count: number }> {
  const end = (deps.now ?? (() => new Date()))();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  // ponytail: stateless 7-day lookback keyed to run time. A failed/skipped run drops that week's
  // PRs; a PR merged inside the few-second jitter between consecutive Monday fires can appear
  // twice or never. Add a last-run cursor in app_setting if either bites.
  const window: Window = { start, end };

  const prs = await fetchMergedPrs(deps, window);
  const text = formatWhatsNew(prs, window);
  if (text === null) return { posted: false, count: 0 };

  const posted = await postChannelMessage(deps.slack, "hub-admin-alerts", text);
  return { posted, count: prs.length };
}

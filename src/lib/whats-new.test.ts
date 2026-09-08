import { describe, expect, test, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { SlackDeps } from "./slack";
import type { GithubAppCredentials } from "./github-app";
import { formatWhatsNew, sendWhatsNewDigest, type MergedPr, type Window } from "./whats-new";

type CapturedRequest = { url: string; init?: RequestInit };

function fakeFetch(responses: { status: number; body?: unknown }[] = []) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { ok: true } };
    return new Response(next.body !== undefined ? JSON.stringify(next.body) : undefined, {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

function bodyOf(req: CapturedRequest) {
  return JSON.parse(req.init!.body as string) as Record<string, unknown>;
}

function pr(overrides: Partial<{
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
}> = {}) {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Some change",
    html_url: overrides.html_url ?? `https://github.com/RAR1741/hub/pull/${overrides.number ?? 1}`,
    merged_at: overrides.merged_at === undefined ? "2026-09-02T00:00:00Z" : overrides.merged_at,
    user: overrides.user === undefined ? { login: "dracco1993" } : overrides.user,
    labels: overrides.labels ?? [],
  };
}

const WINDOW: Window = { start: new Date("2026-08-31T13:00:00Z"), end: new Date("2026-09-07T13:00:00Z") };

function mergedPr(overrides: Partial<MergedPr> = {}): MergedPr {
  return {
    number: 1,
    title: "Some change",
    htmlUrl: "https://github.com/RAR1741/hub/pull/1",
    mergedAt: "2026-09-02T00:00:00Z",
    author: "dracco1993",
    labels: [],
    ...overrides,
  };
}

describe("formatWhatsNew", () => {
  test("empty array -> null", () => {
    expect(formatWhatsNew([], WINDOW)).toBeNull();
  });

  test("header renders window dates", () => {
    const text = formatWhatsNew([mergedPr()], WINDOW);
    expect(text).toContain("*What's new in the hub* (2026-08-31 – 2026-09-07)");
  });

  test("bullets sorted by mergedAt ascending regardless of input order", () => {
    const later = mergedPr({ number: 2, title: "Later PR", htmlUrl: "https://github.com/RAR1741/hub/pull/2", mergedAt: "2026-09-05T00:00:00Z", author: "alice" });
    const earlier = mergedPr({ number: 1, title: "Earlier PR", htmlUrl: "https://github.com/RAR1741/hub/pull/1", mergedAt: "2026-09-01T00:00:00Z", author: "bob" });
    const text = formatWhatsNew([later, earlier], WINDOW)!;
    const earlierIdx = text.indexOf("Earlier PR");
    const laterIdx = text.indexOf("Later PR");
    expect(earlierIdx).toBeGreaterThan(-1);
    expect(laterIdx).toBeGreaterThan(-1);
    expect(earlierIdx).toBeLessThan(laterIdx);
    expect(text).toContain("• <https://github.com/RAR1741/hub/pull/1|Earlier PR> (#1, @bob)");
  });

  test("heads-up grouping: labelled PR under Watch out for, precedes What's new; enhancement does not trigger", () => {
    const headsUp = mergedPr({ number: 1, title: "Breaking change", labels: ["heads-up"] });
    const normal = mergedPr({ number: 2, title: "Normal change", labels: ["enhancement"] });
    const text = formatWhatsNew([headsUp, normal], WINDOW)!;
    expect(text).toContain(":warning: *Watch out for*");
    expect(text).toContain("*What's new*");
    const watchIdx = text.indexOf(":warning: *Watch out for*");
    const newIdx = text.indexOf("*What's new*");
    expect(watchIdx).toBeLessThan(newIdx);
    expect(text.indexOf("Breaking change")).toBeLessThan(newIdx);
    expect(text.indexOf("Normal change")).toBeGreaterThan(newIdx);
  });

  test("all PRs heads-up -> no What's new heading", () => {
    const headsUp = mergedPr({ labels: ["Heads-Up"] }); // case-insensitive match
    const text = formatWhatsNew([headsUp], WINDOW)!;
    expect(text).toContain(":warning: *Watch out for*");
    expect(text).not.toContain("*What's new*");
  });

  test("escapes &, <, > in title; URL untouched", () => {
    const p = mergedPr({ title: "A <b> & c", htmlUrl: "https://github.com/RAR1741/hub/pull/1&x=1" });
    const text = formatWhatsNew([p], WINDOW)!;
    expect(text).toContain("<https://github.com/RAR1741/hub/pull/1&x=1|A &lt;b&gt; &amp; c>");
  });
});

describe("sendWhatsNewDigest", () => {
  const prodSlack = (fetchFn: typeof globalThis.fetch): SlackDeps => ({ fetch: fetchFn, token: "xoxb", isProd: true });
  const NOW = () => new Date("2026-09-07T13:00:00Z");

  test("filters window: in-window PR kept, null merged_at dropped, 8-days-ago dropped", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: [
          pr({ number: 1, title: "In window", merged_at: "2026-09-02T00:00:00Z" }),
          pr({ number: 2, title: "Not merged", merged_at: null }),
          pr({ number: 3, title: "Too old", merged_at: "2026-08-29T00:00:00Z" }),
        ],
      },
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    vi.stubEnv("GITHUB_ORG", "RAR1741");
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: null, now: NOW });
    expect(result).toEqual({ posted: true, count: 1 });
    const slackReq = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(slackReq).text).toContain("In window");
    expect(bodyOf(slackReq).text).not.toContain("Too old");
    vi.unstubAllEnvs();
  });

  test("anonymous path: exactly one GitHub request, exact URL, no Authorization header", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: [] },
    ]);
    vi.stubEnv("GITHUB_ORG", "RAR1741");
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: null, now: NOW });
    expect(result).toEqual({ posted: false, count: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://api.github.com/repos/RAR1741/hub/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=100",
    );
    const headers = requests[0].init!.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["User-Agent"]).toBe("rar1741-hub");
    expect(headers.Authorization).toBeUndefined();
    vi.unstubAllEnvs();
  });

  test("credentialed path: token exchange then pulls with Authorization bearer", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const creds: GithubAppCredentials = {
      appId: "12345",
      privateKey: PEM,
      installationId: "999",
      org: "RAR1741",
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    const { fetchFn, requests } = fakeFetch([
      { status: 201, body: { token: "ghs_x" } }, // access_tokens
      { status: 200, body: [pr({ number: 1, title: "Creds PR", merged_at: "2026-09-02T00:00:00Z" })] }, // pulls
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: creds, now: NOW });
    expect(result).toEqual({ posted: true, count: 1 });
    const pullsReq = requests.find((r) => r.url.includes("/pulls"))!;
    const headers = pullsReq.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghs_x");
  });

  test("token exchange 500 falls back to anonymous, still posts", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const creds: GithubAppCredentials = {
      appId: "12345",
      privateKey: PEM,
      installationId: "999",
      org: "RAR1741",
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    const { fetchFn, requests } = fakeFetch([
      { status: 500, body: { message: "boom" } }, // access_tokens fails
      { status: 200, body: [pr({ number: 1, title: "Fallback PR", merged_at: "2026-09-02T00:00:00Z" })] }, // anonymous pulls
      { status: 200, body: { ok: true } }, // chat.postMessage
    ]);
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: creds, now: NOW });
    expect(result).toEqual({ posted: true, count: 1 });
    const pullsReq = requests.find((r) => r.url.includes("/pulls"))!;
    const headers = pullsReq.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("empty week -> no chat.postMessage, {posted:false,count:0}", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: [] }]);
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: null, now: NOW });
    expect(result).toEqual({ posted: false, count: 0 });
    expect(requests.some((r) => r.url.includes("chat.postMessage"))).toBe(false);
  });

  test("GitHub 403 on pulls -> rejects", async () => {
    const { fetchFn } = fakeFetch([{ status: 403, body: { message: "rate limited" } }]);
    await expect(sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: null, now: NOW })).rejects.toThrow(
      "whats-new: list pulls failed: 403",
    );
  });

  test("slack body channel is hub-admin-alerts id and text starts with header; returns posted:true,count:N", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: [
          pr({ number: 1, title: "First", merged_at: "2026-09-01T00:00:00Z" }),
          pr({ number: 2, title: "Second", merged_at: "2026-09-03T00:00:00Z" }),
        ],
      },
      { status: 200, body: { ok: true } },
    ]);
    const result = await sendWhatsNewDigest({ fetch: fetchFn, slack: prodSlack(fetchFn), githubCredentials: null, now: NOW });
    expect(result).toEqual({ posted: true, count: 2 });
    const slackReq = requests.find((r) => r.url.includes("chat.postMessage"))!;
    expect(bodyOf(slackReq).channel).toBe("C0BTB9TMAE8");
    expect((bodyOf(slackReq).text as string).startsWith("*What's new in the hub*")).toBe(true);
  });
});

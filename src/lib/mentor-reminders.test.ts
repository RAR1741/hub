import { describe, expect, test } from "vitest";
import { outstandingItems, sendMentorReminders, type MentorReq } from "./mentor-reminders";
import type { SlackDeps } from "./slack";

describe("outstandingItems", () => {
  const base: MentorReq = { personId: "p", name: "M", slackUserId: "U", consent: true, screeningStatus: "green", trainingStatus: "green" };
  test("fully complete → empty", () => {
    expect(outstandingItems(base)).toEqual([]);
  });
  test("missing consent is listed", () => {
    expect(outstandingItems({ ...base, consent: false })).toContain("Consent & release form");
  });
  test("non-green screening is listed", () => {
    expect(outstandingItems({ ...base, screeningStatus: "blue" })).toContain("Youth Protection screening");
  });
  test("non-green training is listed", () => {
    expect(outstandingItems({ ...base, trainingStatus: null })).toContain("Required training");
  });
  test("never-synced (all null) lists everything", () => {
    expect(outstandingItems({ ...base, consent: null, screeningStatus: null, trainingStatus: null })).toHaveLength(3);
  });
});

// Fake db honoring sendMentorReminders' query shape:
//   db.from("person").select(...).in("role", [...]).eq("is_active", true) -> { data, error }
function fakeDb(people: Record<string, unknown>[]) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              return {
                eq() {
                  return Promise.resolve({ data: people, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

// Spy fetch capturing every chat.postMessage body; mirrors fakeFetch style from slack.test.ts.
function spySlack(): { posts: { channel: string; text: string }[]; deps: SlackDeps } {
  const posts: { channel: string; text: string }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("chat.postMessage")) {
      posts.push(JSON.parse(init!.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  // isProd: false so both DM and channel post redirect to #bot-test, distinguishable by prefix.
  return { posts, deps: { fetch: fetchFn, token: "xoxb", isProd: false } };
}

function person(overrides: Record<string, unknown>) {
  return {
    id: "p",
    first_name: "First",
    last_name: "Name",
    display_name: null,
    slack_user_id: null,
    first_consent_release: true,
    first_screening_status: "green",
    first_training_status: "green",
    first_people_id: 1,
    ...overrides,
  };
}

describe("sendMentorReminders", () => {
  test("DMs only linked incomplete mentors, reports unlinked by name, skips complete", async () => {
    const people = [
      person({ id: "pA", first_name: "A", last_name: "Name", slack_user_id: "UA", first_consent_release: false }),
      person({ id: "pB", first_name: "B", last_name: "Name", slack_user_id: null, first_consent_release: false }),
      person({ id: "pC", first_name: "C", last_name: "Name", slack_user_id: "UC" }),
    ];
    const db = fakeDb(people);
    const { posts, deps } = spySlack();

    const result = await sendMentorReminders({ db: db as never, slack: deps, sleep: async () => {} });

    expect(result.reminded).toBe(1);
    expect(result.unlinked).toEqual(["B Name"]);
    expect(result.complete).toBe(1);
    expect(result.failed).toEqual([]);

    const dms = posts.filter((p) => p.text.startsWith("[dev → DM"));
    expect(dms).toHaveLength(1);
    expect(dms[0].text).toContain("[dev → DM UA]");
    expect(posts.some((p) => p.text.includes("DM UC"))).toBe(false);

    const summaryPost = posts.find((p) => p.text.startsWith("[dev → #hub_alerts]"));
    expect(summaryPost).toBeDefined();
    expect(summaryPost!.text).toContain("B Name");
  });

  test("a linked incomplete mentor whose DM fails is reported as failed, not reminded", async () => {
    const people = [
      person({ id: "pA", first_name: "A", last_name: "Name", slack_user_id: "UA", first_consent_release: false }),
    ];
    const db = fakeDb(people);
    const posts: { channel: string; text: string }[] = [];
    // DM sends fail (ok:false); any other post (the summary) succeeds.
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(init.body as string) as { channel: string; text: string }) : undefined;
      if (body && String(url).includes("chat.postMessage")) posts.push(body);
      const failed = !!body?.text.startsWith("[dev → DM");
      return new Response(JSON.stringify({ ok: !failed }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const deps: SlackDeps = { fetch: fetchFn, token: "xoxb", isProd: false };

    const result = await sendMentorReminders({ db: db as never, slack: deps, sleep: async () => {} });

    expect(result.reminded).toBe(0);
    expect(result.failed).toEqual(["A Name"]);

    const summaryPost = posts.find((p) => p.text.startsWith("[dev → #hub_alerts]"));
    expect(summaryPost).toBeDefined();
    expect(summaryPost!.text).toContain("A Name");
    expect(summaryPost!.text).toContain("DM failed");
  });
});

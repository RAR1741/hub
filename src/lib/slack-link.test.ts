import { describe, expect, test } from "vitest";
import { fetchSlackMembers, syncSlackLinks, type LinkReport } from "./slack-link";
import type { SlackDeps } from "./slack";

type CapturedRequest = { url: string };

// Fake fetch for users.list: dispatches a queue of canned responses (one per call),
// and records every request URL it received.
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string | URL | Request) => {
    const href = String(url);
    requests.push({ url: href });
    const next = queue.shift();
    if (!next) throw new Error(`no fake response queued for ${href}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, requests };
}

function slackDeps(responses: { status: number; body: unknown }[]): { deps: SlackDeps; requests: CapturedRequest[] } {
  const { fetchFn, requests } = fakeFetch(responses);
  return { deps: { fetch: fetchFn, token: "xoxb", isProd: true }, requests };
}

type Person = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  email: string | null;
  slack_user_id: string | null;
  is_active: boolean;
};
type Identity = { person_id: string; email: string };

// Fake db honoring the two shapes syncSlackLinks needs:
//   db.from("person").select(...) -> { data, error }
//   db.from("person_identity").select(...) -> { data, error }
//   db.from("person").update({slack_user_id}).eq("id", personId) -> { error }
function fakeDb(people: Person[], identities: Identity[] = []) {
  const updates: { table: string; values: Record<string, unknown>; id: string }[] = [];
  const upserts: { table: string; values: Record<string, unknown> }[] = [];
  return {
    updates,
    upserts,
    people,
    from(table: string) {
      return {
        select() {
          return Promise.resolve(
            table === "person"
              ? { data: people, error: null }
              : table === "person_identity"
                ? { data: identities, error: null }
                : { data: [], error: null },
          );
        },
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, id: string) {
              const row = people.find((p) => (p as Record<string, unknown>)[col] === id);
              if (row) Object.assign(row, values);
              updates.push({ table, values, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(values: Record<string, unknown>) {
          upserts.push({ table, values });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function person(overrides: Partial<Person>): Person {
  return {
    id: "p1",
    first_name: "First",
    last_name: "Last",
    display_name: null,
    email: null,
    slack_user_id: null,
    is_active: true,
    ...overrides,
  };
}

function member(id: string, email: string, name = "", extra: Record<string, unknown> = {}) {
  return { id, profile: { email }, real_name: name, ...extra };
}

// Original 3-positional-arg form used by pre-existing fetchSlackMembers tests
// (extra flags like { deleted: true }, no name involved).
function rawMember(id: string, email: string, extra: Record<string, unknown> = {}) {
  return { id, profile: { email }, ...extra };
}

describe("fetchSlackMembers", () => {
  test("filters deleted/bot/restricted/unconfirmed/no-email, lowercases emails, and paginates", async () => {
    const { deps, requests } = slackDeps([
      {
        status: 200,
        body: {
          ok: true,
          members: [
            rawMember("U1", "Alice@Example.com"),
            rawMember("U2", "bob@example.com", { deleted: true }),
            rawMember("U3", "bot@example.com", { is_bot: true }),
            rawMember("U4", "restricted@example.com", { is_restricted: true }),
            rawMember("U5", "ultra@example.com", { is_ultra_restricted: true }),
            rawMember("U6", "unconfirmed@example.com", { is_email_confirmed: false }),
            { id: "U7", profile: {} },
          ],
          response_metadata: { next_cursor: "page2" },
        },
      },
      {
        status: 200,
        body: {
          ok: true,
          members: [member("U8", "carol@example.com")],
          response_metadata: { next_cursor: "" },
        },
      },
    ]);

    const result = await fetchSlackMembers(deps);

    expect(result).toEqual([
      { id: "U1", email: "alice@example.com", name: "" },
      { id: "U8", email: "carol@example.com", name: "" },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("cursor=page2");
  });

  test("name sourcing prefers profile.real_name, then real_name, then profile.display_name, else empty", async () => {
    const { deps } = slackDeps([
      {
        status: 200,
        body: {
          ok: true,
          members: [
            { id: "U1", profile: { email: "a@example.com", real_name: "Profile Real", display_name: "Display" }, real_name: "Top Real" },
            { id: "U2", profile: { email: "b@example.com", display_name: "Display Only" }, real_name: "Top Real" },
            { id: "U3", profile: { email: "c@example.com", display_name: "Display Only 2" } },
            { id: "U4", profile: { email: "d@example.com" } },
          ],
          response_metadata: { next_cursor: "" },
        },
      },
    ]);

    const result = await fetchSlackMembers(deps);

    expect(result).toEqual([
      { id: "U1", email: "a@example.com", name: "Profile Real" },
      { id: "U2", email: "b@example.com", name: "Top Real" },
      { id: "U3", email: "c@example.com", name: "Display Only 2" },
      { id: "U4", email: "d@example.com", name: "" },
    ]);
  });
});

describe("syncSlackLinks", () => {
  test("links a member whose email matches person.email (case-insensitive)", async () => {
    const people = [person({ id: "p1", email: "Alice@Example.com" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "alice@example.com")] } },
    ]);

    const report: LinkReport = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(1);
    expect(db.updates).toEqual([{ table: "person", values: { slack_user_id: "U1" }, id: "p1" }]);
    expect(people[0].slack_user_id).toBe("U1");
  });

  test("links a member matching a person_identity.email but not person.email", async () => {
    const people = [person({ id: "p1", email: "primary@example.com" })];
    const identities = [{ person_id: "p1", email: "alt@example.com" }];
    const db = fakeDb(people, identities);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "alt@example.com")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(1);
    expect(people[0].slack_user_id).toBe("U1");
  });

  test("email matching two different people is ambiguous, no write", async () => {
    const people = [
      person({ id: "p1", email: "shared@example.com" }),
      person({ id: "p2", email: "shared@example.com" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "shared@example.com")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.ambiguous).toEqual([{ email: "shared@example.com", personIds: expect.arrayContaining(["p1", "p2"]) }]);
    expect(report.ambiguous[0].personIds).toHaveLength(2);
    expect(report.linked).toBe(0);
    expect(db.updates).toHaveLength(0);
    expect(people[0].slack_user_id).toBeNull();
    expect(people[1].slack_user_id).toBeNull();
  });

  test("member already linked to the same person counts as alreadyLinked, no redundant update", async () => {
    const people = [person({ id: "p1", email: "alice@example.com", slack_user_id: "U1" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "alice@example.com")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.alreadyLinked).toBe(1);
    expect(report.linked).toBe(0);
    expect(db.updates).toHaveLength(0);
  });

  test("unmatched slack members and unmatched active people are both reported", async () => {
    const people = [
      person({ id: "p1", email: "matched@example.com" }),
      person({ id: "p2", email: "nomatch@example.com", first_name: "No", last_name: "Match" }),
      person({ id: "p3", email: null, is_active: false, first_name: "Inactive", last_name: "Person" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      {
        status: 200,
        body: {
          ok: true,
          members: [member("U1", "matched@example.com"), member("U2", "stray@example.com")],
        },
      },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.unmatchedSlack).toEqual([{ id: "U2", email: "stray@example.com", name: "" }]);
    expect(report.unmatchedPeople).toEqual([{ personId: "p2", name: "No Match" }]);
  });

  test("name fallback: no email match, name normalizes to exactly one unlinked person", async () => {
    const people = [person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "Jane   Doe")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(1);
    expect(people[0].slack_user_id).toBe("U1");
    expect(report.unmatchedSlack).toEqual([]);
    expect(report.unmatchedPeople).toEqual([]);
  });

  test("name fallback matches via display_name", async () => {
    const people = [
      person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe", display_name: "JD" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "JD")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(1);
    expect(people[0].slack_user_id).toBe("U1");
  });

  test("name never overwrites an existing slack_user_id", async () => {
    const people = [
      person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe", slack_user_id: "UOLD" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "Jane Doe")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(0);
    expect(people[0].slack_user_id).toBe("UOLD");
    expect(report.unmatchedSlack).toEqual([{ id: "U1", email: "nomatch@example.com", name: "Jane Doe" }]);
  });

  test("name-ambiguous: two unlinked people share a normalized name", async () => {
    const people = [
      person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe" }),
      person({ id: "p2", email: null, first_name: "Jane", last_name: "Doe" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "Jane Doe")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(0);
    expect(report.ambiguous).toEqual([]);
    expect(report.unmatchedSlack).toEqual([{ id: "U1", email: "nomatch@example.com", name: "Jane Doe" }]);
    expect(people[0].slack_user_id).toBeNull();
    expect(people[1].slack_user_id).toBeNull();
  });

  test("claim-once: two Slack members with the same name, only the first claims", async () => {
    const people = [person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      {
        status: 200,
        body: {
          ok: true,
          members: [
            member("U1", "a@example.com", "Jane Doe"),
            member("U2", "b@example.com", "Jane Doe"),
          ],
        },
      },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(1);
    expect(people[0].slack_user_id).toBe("U1");
    expect(report.unmatchedSlack).toEqual([{ id: "U2", email: "b@example.com", name: "Jane Doe" }]);
  });

  test("email claim blocks a same-named member's name claim", async () => {
    const people = [person({ id: "p1", email: "jane@example.com", first_name: "Jane", last_name: "Doe" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      {
        status: 200,
        body: {
          ok: true,
          members: [
            member("U1", "jane@example.com", "Jane Doe"),
            member("U2", "other@example.com", "Jane Doe"),
          ],
        },
      },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(people[0].slack_user_id).toBe("U1");
    expect(report.linked).toBe(1);
    expect(report.unmatchedSlack).toEqual([{ id: "U2", email: "other@example.com", name: "Jane Doe" }]);
  });

  test("ambiguous email terminates the ladder: no name fallback, not in unmatchedSlack", async () => {
    const people = [
      person({ id: "p1", email: "shared@example.com", first_name: "Jane", last_name: "Doe" }),
      person({ id: "p2", email: "shared@example.com", first_name: "Other", last_name: "Person" }),
    ];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "shared@example.com", "Jane Doe")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.ambiguous).toHaveLength(1);
    expect(report.unmatchedSlack).toEqual([]);
    expect(report.linked).toBe(0);
    expect(people[0].slack_user_id).toBeNull();
  });

  test("empty name with no email match goes straight to unmatchedSlack", async () => {
    const people = [person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(report.linked).toBe(0);
    expect(report.unmatchedSlack).toEqual([{ id: "U1", email: "nomatch@example.com", name: "" }]);
  });

  test("persists the sync report to app_setting/slack_last_sync_report", async () => {
    const people = [person({ id: "p1", email: null, first_name: "Jane", last_name: "Doe" })];
    const db = fakeDb(people);
    const { deps } = slackDeps([
      { status: 200, body: { ok: true, members: [member("U1", "nomatch@example.com", "")] } },
    ]);

    const report = await syncSlackLinks({ db: db as never, slack: deps });

    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].table).toBe("app_setting");
    expect(db.upserts[0].values).toMatchObject({ key: "slack_last_sync_report" });
    const persisted = db.upserts[0].values.value as LinkReport;
    expect(persisted.ranAt).toBe(report.ranAt);
    expect(typeof persisted.ranAt).toBe("string");
    expect(persisted.unmatchedSlack).toEqual([{ id: "U1", email: "nomatch@example.com", name: "" }]);
  });
});

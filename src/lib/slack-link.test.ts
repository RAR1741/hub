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
  return {
    updates,
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

function member(id: string, email: string, extra: Record<string, unknown> = {}) {
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
            member("U1", "Alice@Example.com"),
            member("U2", "bob@example.com", { deleted: true }),
            member("U3", "bot@example.com", { is_bot: true }),
            member("U4", "restricted@example.com", { is_restricted: true }),
            member("U5", "ultra@example.com", { is_ultra_restricted: true }),
            member("U6", "unconfirmed@example.com", { is_email_confirmed: false }),
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
      { id: "U1", email: "alice@example.com" },
      { id: "U8", email: "carol@example.com" },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("cursor=page2");
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

    expect(report.unmatchedSlack).toEqual([{ id: "U2", email: "stray@example.com" }]);
    expect(report.unmatchedPeople).toEqual([{ personId: "p2", name: "No Match" }]);
  });
});

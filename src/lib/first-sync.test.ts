import { describe, expect, test } from "vitest";
import {
  parseTeamContactsModel,
  adultsFromModel,
  statusUrl,
  matchFirstToHub,
  syncFirstRoster,
  type FirstPerson,
  type HubCandidate,
} from "./first-sync";

// Sanitized fixture (shape captured live 2026-08-26; names/emails fake).
const MODEL = {
  PeopleRoles: [
    { peopleId: 101, name_first: "Alice", name_last: "Anderson", email: "ALICE@example.org", phone: "555-0001", role_category: "Primary Team Contacts", role_key: "coach-1", ConsentReleaseStatus: true },
    { peopleId: 101, name_first: "Alice", name_last: "Anderson", email: "alice@example.org", phone: "555-0001", role_category: "Additional Team Contacts", role_key: "Mentor", ConsentReleaseStatus: false },
    { peopleId: 102, name_first: "Bob", name_last: "Baker", email: "bob@example.org", phone: "555-0002", role_category: "Additional Team Contacts", role_key: "Mentor", ConsentReleaseStatus: false },
    { peopleId: 201, name_first: "Kid", name_last: "Kiddo", email: "kid@example.org", phone: "", role_category: "Youth Team Members", role_key: "youth", ConsentReleaseStatus: false },
  ],
};
const HTML = `<html><script>var x=1; window.teamContactsModel = ${JSON.stringify(MODEL)};</script></html>`;

describe("parseTeamContactsModel", () => {
  test("extracts the model object from HTML", () => {
    const model = parseTeamContactsModel(HTML) as { PeopleRoles: unknown[] };
    expect(model.PeopleRoles).toHaveLength(4);
  });

  test("throws when the marker is absent", () => {
    expect(() => parseTeamContactsModel("<html><body>nope</body></html>")).toThrow();
  });

  test("skips earlier teamContactsModel references and finds the real assignment", () => {
    // The live page mentions `teamContactsModel` several times before the real
    // data: member-access references and a `$.ajax` block with unquoted JS keys.
    // The parser must skip those and only take the `= { ...PeopleRoles... }`
    // assignment (regression: it used to grab the first occurrence and choke on
    // the JS-literal `$.ajax` block).
    const decoyed =
      `<script>` +
      // JS block whose object literal has unquoted keys + a function — the old
      // "first =, first {" parser grabbed this and JSON.parse threw here.
      `teamContactsModel.load = function () { $.ajax({ url: '/x', success: function (d) { render(d); } }); };` +
      `if (teamContactsModel.PeopleRoles) { render(teamContactsModel); }` +
      `</script>` +
      `<script>var teamContactsModel = ${JSON.stringify(MODEL)};</script>`;
    const model = parseTeamContactsModel(decoyed) as { PeopleRoles: unknown[] };
    expect(model.PeopleRoles).toHaveLength(4);
  });
});

describe("adultsFromModel", () => {
  const adults = adultsFromModel(MODEL);

  test("filters youth and dedupes by peopleId", () => {
    expect(adults).toHaveLength(2);
    expect(adults.map((p) => p.peopleId).sort()).toEqual([101, 102]);
  });

  test("merges ConsentReleaseStatus any-true", () => {
    const alice = adults.find((p) => p.peopleId === 101)!;
    const bob = adults.find((p) => p.peopleId === 102)!;
    expect(alice.consentRelease).toBe(true);
    expect(bob.consentRelease).toBe(false);
  });

  test("lowercases email", () => {
    const alice = adults.find((p) => p.peopleId === 101)!;
    expect(alice.email).toBe("alice@example.org");
  });

  test("keeps first-seen non-empty email when the first role row has a blank email", () => {
    const model = {
      PeopleRoles: [
        { peopleId: 301, name_first: "Dana", name_last: "Diaz", email: "", phone: "", role_category: "Additional Team Contacts", role_key: "Mentor", ConsentReleaseStatus: false },
        { peopleId: 301, name_first: "Dana", name_last: "Diaz", email: "DANA@example.org", phone: "555-0003", role_category: "Primary Team Contacts", role_key: "coach-2", ConsentReleaseStatus: true },
      ],
    };
    const [dana] = adultsFromModel(model);
    expect(dana.email).toBe("dana@example.org");
  });
});

describe("statusUrl", () => {
  test("builds repeated &ids= params, not comma-separated", () => {
    expect(statusUrl("1790765", [101, 102])).toBe(
      "https://my.firstinspires.org/Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=1790765&ids=101&ids=102",
    );
  });
});

// Minimal fake db: app_setting get/set by key, empty person/person_identity rosters.
function fakeDb(settings: Record<string, unknown>) {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table === "app_setting") {
        return {
          select: () => ({ eq: (_col: string, key: string) => ({ maybeSingle: async () => ({ data: key in settings ? { value: settings[key] } : null, error: null }) }) }),
          upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; },
        };
      }
      if (table === "person") {
        return { select: () => ({ in: () => ({ data: [], error: null }) }) };
      }
      if (table === "person_identity") {
        return { select: () => ({ data: [], error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
  return { db, upserts };
}

const ROSTER_MODEL = { PeopleRoles: [] };
const ROSTER_HTML = `<html><script>window.teamContactsModel = ${JSON.stringify(ROSTER_MODEL)};</script></html>`;

describe("syncFirstRoster cookie rotation", () => {
  test("persists the rotated cookie after both fetches succeed, preserving savedAt", async () => {
    const { db, upserts } = fakeDb({
      first_team_profile_id: "1790765",
      first_session: { cookie: "old=1", savedAt: "2026-01-01T00:00:00.000Z" },
    });
    let call = 0;
    const fetchFn = (async (_url: string) => {
      call++;
      if (call === 1) {
        return {
          status: 200,
          headers: { getSetCookie: () => ["old=2"], get: () => null },
          text: async () => ROSTER_HTML,
        };
      }
      return {
        status: 200,
        headers: { getSetCookie: () => ["old=3"], get: () => null },
        text: async () => "[]",
      };
    }) as unknown as typeof fetch;

    const report = await syncFirstRoster({ db, fetchFn });

    expect(report.rosterCount).toBe(0);
    const sessionUpsert = upserts.find((u) => u.key === "first_session");
    expect(sessionUpsert).toBeDefined();
    const value = sessionUpsert!.value as { cookie: string; savedAt: string; rotatedAt: string };
    expect(value.cookie).toBe("old=3"); // rotated on both requests, ends at the status fetch's cookie
    expect(value.savedAt).toBe("2026-01-01T00:00:00.000Z"); // preserved, not overwritten
    expect(value.rotatedAt).toBeTypeOf("string");
  });

  test("skips the session upsert when the cookie never rotates", async () => {
    const { db, upserts } = fakeDb({
      first_team_profile_id: "1790765",
      first_session: { cookie: "old=1", savedAt: "2026-01-01T00:00:00.000Z" },
    });
    let call = 0;
    const fetchFn = (async () => {
      call++;
      return {
        status: 200,
        headers: { getSetCookie: () => [], get: () => null },
        text: async () => (call === 1 ? ROSTER_HTML : "[]"),
      };
    }) as unknown as typeof fetch;

    await syncFirstRoster({ db, fetchFn });

    expect(upserts.find((u) => u.key === "first_session")).toBeUndefined();
  });
});

describe("matchFirstToHub", () => {
  const alice: FirstPerson = {
    peopleId: 101,
    firstName: "Alice",
    lastName: "Anderson",
    email: "alice@example.org",
    consentRelease: true,
    screeningStatus: "green",
    screeningText: null,
    trainingStatus: "green",
  };
  const bob: FirstPerson = {
    peopleId: 102,
    firstName: "Bob",
    lastName: "Baker",
    email: "bob@example.org",
    consentRelease: false,
    screeningStatus: "blue",
    screeningText: null,
    trainingStatus: "blue",
  };
  const carol: FirstPerson = {
    peopleId: 103,
    firstName: "Carol",
    lastName: "Chen",
    email: "carol@example.org",
    consentRelease: false,
    screeningStatus: null,
    screeningText: null,
    trainingStatus: null,
  };
  const nobody: FirstPerson = {
    peopleId: 104,
    firstName: "Nobody",
    lastName: "Nowhere",
    email: "nobody@example.org",
    consentRelease: false,
    screeningStatus: null,
    screeningText: null,
    trainingStatus: null,
  };

  test("matches by existing firstPeopleId even when email differs", () => {
    const hub: HubCandidate[] = [
      { personId: "p1", name: "Alice A", firstName: "Alice", lastName: "Anderson", firstPeopleId: 101, emails: ["old-alice@example.org"] },
    ];
    const { pairs, unmatchedFirst } = matchFirstToHub([alice], hub);
    expect(pairs).toEqual([{ first: alice, personId: "p1" }]);
    expect(unmatchedFirst).toEqual([]);
  });

  test("falls back to email match (case-insensitive) when no firstPeopleId match", () => {
    const hub: HubCandidate[] = [
      { personId: "p2", name: "Bob B", firstName: "Bobby", lastName: "Bakerson", firstPeopleId: null, emails: ["BOB@example.org"] },
    ];
    const { pairs, unmatchedFirst } = matchFirstToHub([bob], hub);
    expect(pairs).toEqual([{ first: bob, personId: "p2" }]);
    expect(unmatchedFirst).toEqual([]);
  });

  test("falls back to nameKey match when no firstPeopleId or email match", () => {
    const hub: HubCandidate[] = [
      { personId: "p3", name: "Carol Chen", firstName: "Carol", lastName: "Chen", firstPeopleId: null, emails: ["different@example.org"] },
    ];
    const { pairs, unmatchedFirst } = matchFirstToHub([carol], hub);
    expect(pairs).toEqual([{ first: carol, personId: "p3" }]);
    expect(unmatchedFirst).toEqual([]);
  });

  test("unmatched FIRST people land in unmatchedFirst", () => {
    const hub: HubCandidate[] = [];
    const { pairs, unmatchedFirst } = matchFirstToHub([nobody], hub);
    expect(pairs).toEqual([]);
    expect(unmatchedFirst).toEqual([nobody]);
  });

  test("a hub person already claimed by firstPeopleId isn't re-claimed by a later email match", () => {
    // p1 matches alice by firstPeopleId first. bob's email happens to also
    // resolve to p1 in this contrived case (same candidate) — p1 must not be
    // claimed twice; bob should land in unmatchedFirst instead.
    const hub: HubCandidate[] = [
      { personId: "p1", name: "Alice A", firstName: "Alice", lastName: "Anderson", firstPeopleId: 101, emails: ["bob@example.org"] },
    ];
    const { pairs, unmatchedFirst } = matchFirstToHub([alice, bob], hub);
    expect(pairs).toEqual([{ first: alice, personId: "p1" }]);
    expect(unmatchedFirst).toEqual([bob]);
  });
});

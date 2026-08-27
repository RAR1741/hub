import { describe, expect, test } from "vitest";
import {
  parseTeamContactsModel,
  adultsFromModel,
  statusUrl,
  matchFirstToHub,
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
});

describe("statusUrl", () => {
  test("builds repeated &ids= params, not comma-separated", () => {
    expect(statusUrl("1790765", [101, 102])).toBe(
      "https://my.firstinspires.org/Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=1790765&ids=101&ids=102",
    );
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

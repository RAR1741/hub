import { describe, expect, test, vi } from "vitest";
import {
  checkInPerson,
  insertSignupReminders,
  listEventRoster,
  signUpForEvent,
  signedUpEventIds,
  uncheckIn,
} from "./event-signups";
import type { SlackDeps } from "./slack";

/** A SlackDeps whose every real API call throws — used to prove Slack failures never affect the DB result. */
const throwingSlack: SlackDeps = {
  fetch: (() => {
    throw new Error("boom: slack unreachable");
  }) as unknown as typeof globalThis.fetch,
  token: "xoxb-test",
  isProd: true,
};

describe("signUpForEvent", () => {
  function fakeDb(opts: { conflict?: boolean; fkViolation?: boolean; eventEnded?: boolean; noEvent?: boolean }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.noEvent
                    ? null
                    : {
                        id: "e1", period_id: "pd1", name: "Demo", location: null,
                        description: null,
                        starts_at: opts.eventEnded ? "2020-01-01T18:00:00Z" : "2099-01-01T18:00:00Z",
                        ends_at: opts.eventEnded ? "2020-01-01T20:00:00Z" : "2099-01-01T20:00:00Z",
                        created_by: "m1", created_at: "2020-01-01T00:00:00Z",
                      },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table !== "event_signup") throw new Error(`unexpected table ${table}`);
        return {
          insert: async () => ({
            error: opts.conflict
              ? { code: "23505" }
              : opts.fkViolation
                ? { code: "23503" }
                : null,
          }),
        };
      },
    } as never;
  }

  test("201 on a fresh sign-up", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({}))).toEqual({ ok: true, status: 201 });
  });

  test("409 when already signed up", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ conflict: true })))
      .toEqual({ ok: false, status: 409 });
  });

  test("400 on a bad event/person id", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ fkViolation: true })))
      .toEqual({ ok: false, status: 400 });
  });

  test("409 when the event doesn't exist", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ noEvent: true })))
      .toEqual({ ok: false, status: 409 });
  });

  test("409 when the event has already ended", async () => {
    expect(await signUpForEvent("e1", "p1", fakeDb({ eventEnded: true })))
      .toEqual({ ok: false, status: 409 });
  });
});

describe("signUpForEvent — Slack hook never changes the result", () => {
  function fakeDb(opts: { slackChannelId: string | null; slackArchivedAt: string | null; personSlackId: string | null }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "e1", period_id: "pd1", name: "Demo", location: null, description: null,
                    starts_at: "2099-01-01T18:00:00Z", ends_at: "2099-01-01T20:00:00Z",
                    created_by: "m1", created_at: "2020-01-01T00:00:00Z",
                    slack_channel_id: opts.slackChannelId, slack_channel_name: null,
                    slack_archived_at: opts.slackArchivedAt,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "event_signup") {
          return { insert: async () => ({ error: null }) };
        }
        if (table === "person") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { slack_user_id: opts.personSlackId }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("signup still succeeds when the Slack invite throws", async () => {
    const db = fakeDb({ slackChannelId: "C1", slackArchivedAt: null, personSlackId: "U123" });
    const result = await signUpForEvent("e1", "p1", db, throwingSlack);
    expect(result).toEqual({ ok: true, status: 201 });
  });
});

describe("insertSignupReminders", () => {
  test("empty minutes -> no insert call, returns true", async () => {
    let called = false;
    const db = {
      from(table: string) {
        if (table !== "event_signup_reminder") throw new Error(`unexpected table ${table}`);
        called = true;
        return { insert: async () => ({ error: null }) };
      },
    } as never;
    expect(await insertSignupReminders(db, "e1", "p1", [])).toBe(true);
    expect(called).toBe(false);
  });

  test("[15,60] -> two rows inserted", async () => {
    let inserted: unknown[] = [];
    const db = {
      from(table: string) {
        if (table !== "event_signup_reminder") throw new Error(`unexpected table ${table}`);
        return {
          insert: async (rows: unknown[]) => {
            inserted = rows;
            return { error: null };
          },
        };
      },
    } as never;
    expect(await insertSignupReminders(db, "e1", "p1", [15, 60])).toBe(true);
    expect(inserted).toEqual([
      { event_id: "e1", person_id: "p1", minutes: 15 },
      { event_id: "e1", person_id: "p1", minutes: 60 },
    ]);
  });

  test("insert error -> logs and returns false", async () => {
    const db = {
      from(table: string) {
        if (table !== "event_signup_reminder") throw new Error(`unexpected table ${table}`);
        return { insert: async () => ({ error: { message: "boom" } }) };
      },
    } as never;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await insertSignupReminders(db, "e1", "p1", [15])).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("signUpForEvent — reminders", () => {
  function fakeDb(opts: { reminderError?: boolean } = {}) {
    const reminderRows: unknown[] = [];
    const db = {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "e1", period_id: "pd1", name: "Demo", location: null, description: null,
                    starts_at: "2099-01-01T18:00:00Z", ends_at: "2099-01-01T20:00:00Z",
                    created_by: "m1", created_at: "2020-01-01T00:00:00Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "event_signup") {
          return { insert: async () => ({ error: null }) };
        }
        if (table === "event_signup_reminder") {
          return {
            insert: async (rows: unknown[]) => {
              reminderRows.push(...rows);
              return { error: opts.reminderError ? { message: "boom" } : null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return Object.assign(db, { __reminderRows: reminderRows });
  }

  test("threads reminderMinutes into event_signup_reminder rows", async () => {
    const db = fakeDb();
    const result = await signUpForEvent("e1", "p1", db as never, undefined, [15, 60]);
    expect(result).toEqual({ ok: true, status: 201 });
    expect(db.__reminderRows).toEqual([
      { event_id: "e1", person_id: "p1", minutes: 15 },
      { event_id: "e1", person_id: "p1", minutes: 60 },
    ]);
  });

  test("signup still returns 201 when the reminder insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await signUpForEvent("e1", "p1", fakeDb({ reminderError: true }) as never, undefined, [15]);
    expect(result).toEqual({ ok: true, status: 201 });
    spy.mockRestore();
  });
});

describe("checkInPerson", () => {
  function fakeDb(opts: { eventExists: boolean; conflict?: boolean }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.eventExists
                    ? {
                        id: "e1", period_id: "pd1", name: "Demo", location: null,
                        description: null, starts_at: "2027-03-01T18:00:00Z",
                        ends_at: "2027-03-01T20:00:00Z", created_by: "m1",
                        created_at: "2027-01-01T00:00:00Z",
                      }
                    : null,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "session") {
          return {
            insert: async () => ({ error: opts.conflict ? { code: "23505" } : null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("404 when the event doesn't exist", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: false })))
      .toEqual({ ok: false, status: 404 });
  });

  test("201 on a fresh check-in", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: true })))
      .toEqual({ ok: true, status: 201 });
  });

  test("409 when already checked in to this event", async () => {
    expect(await checkInPerson("e1", "p1", "m1", fakeDb({ eventExists: true, conflict: true })))
      .toEqual({ ok: false, status: 409 });
  });
});

describe("listEventRoster", () => {
  function fakeDb() {
    return {
      from(table: string) {
        if (table === "event_signup") {
          return {
            select: () => ({
              eq: async () => ({
                data: [
                  // p1 is linked and invited; p2 is unlinked (no slack_user_id) and never invited
                  { person_id: "p1", slack_invited_at: "2026-01-01T00:00:00Z", person: { id: "p1", first_name: "Ann", last_name: "A", display_name: null, role: "student", slack_user_id: "U1" } },
                  { person_id: "p2", slack_invited_at: null, person: { id: "p2", first_name: "Bo", last_name: "B", display_name: null, role: "mentor", slack_user_id: null } },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "session") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    // p1 signed up AND checked in; p3 checked in without signing up (manual add)
                    { id: "s1", person_id: "p1", person: { id: "p1", first_name: "Ann", last_name: "A", display_name: null, role: "student", slack_user_id: "U1" } },
                    { id: "s2", person_id: "p3", person: { id: "p3", first_name: "Cy", last_name: "C", display_name: null, role: "student", slack_user_id: null } },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("merges signups and check-ins, sorted by name", async () => {
    expect(await listEventRoster("e1", fakeDb())).toEqual([
      { personId: "p1", name: "Ann A", role: "student", signedUp: true, checkedIn: true, sessionId: "s1", slackLinked: true, slackInvitedAt: "2026-01-01T00:00:00Z" },
      { personId: "p2", name: "Bo B", role: "mentor", signedUp: true, checkedIn: false, sessionId: null, slackLinked: false, slackInvitedAt: null },
      { personId: "p3", name: "Cy C", role: "student", signedUp: false, checkedIn: true, sessionId: "s2", slackLinked: false, slackInvitedAt: null },
    ]);
  });
});

describe("uncheckIn", () => {
  function fakeDb(opts: { matches: boolean }) {
    return {
      from(table: string) {
        if (table !== "session") throw new Error(`unexpected table ${table}`);
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: opts.matches ? { id: "s1" } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      },
    } as never;
  }

  test("200 when the session matches this event", async () => {
    expect(await uncheckIn("e1", "s1", fakeDb({ matches: true }))).toEqual({ ok: true, status: 200 });
  });

  test("404 when the session belongs to a different event (or doesn't exist)", async () => {
    expect(await uncheckIn("e1", "s1", fakeDb({ matches: false }))).toEqual({ ok: false, status: 404 });
  });
});

describe("signedUpEventIds", () => {
  test("returns only the ids the person signed up for", async () => {
    const fakeDb = {
      from(table: string) {
        if (table !== "event_signup") throw new Error(`unexpected table ${table}`);
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [{ event_id: "e1" }] }) }) }) };
      },
    } as never;
    expect(await signedUpEventIds("p1", ["e1", "e2"], fakeDb)).toEqual(new Set(["e1"]));
  });
});

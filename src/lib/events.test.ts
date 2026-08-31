import { describe, expect, test } from "vitest";
import { createEvent, deleteEvent, listGcalCandidates, parseEventInput, unlinkEvent, updateEvent } from "./events";
import type { SlackDeps } from "./slack";

/** A SlackDeps whose every real API call throws — used to prove Slack failures never affect the DB result. */
const throwingSlack: SlackDeps = {
  fetch: (() => {
    throw new Error("boom: slack unreachable");
  }) as unknown as typeof globalThis.fetch,
  token: "xoxb-test",
  isProd: true,
};

describe("parseEventInput", () => {
  const base = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T20:00:00Z",
  };

  // parseEventInput normalizes timestamps via toISOString()
  const normalized = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: new Date(base.startsAt).toISOString(),
    endsAt: new Date(base.endsAt).toISOString(),
  };

  test("accepts a valid event with no location/description", () => {
    expect(parseEventInput(base)).toEqual({
      ...normalized,
      location: null,
      description: null,
      gcalEventId: null,
      formId: null,
    });
  });

  test("accepts and trims optional location/description", () => {
    expect(parseEventInput({ ...base, location: " Library ", description: " Bring robot " })).toEqual({
      ...normalized,
      location: "Library",
      description: "Bring robot",
      gcalEventId: null,
      formId: null,
    });
  });

  test.each([
    [{ ...base, name: "" }],
    [{ ...base, periodId: "" }],
    [{ ...base, startsAt: "not-a-date" }],
    [{ ...base, endsAt: "not-a-date" }],
    [{ ...base, endsAt: base.startsAt }], // ends must be strictly after starts
    [{ ...base, endsAt: "2027-03-01T17:00:00Z" }], // ends before starts
    [null],
  ])("rejects %j", (body) => {
    expect(parseEventInput(body)).toBeNull();
  });

  test("rejects a name longer than 120 chars", () => {
    expect(parseEventInput({ ...base, name: "x".repeat(121) })).toBeNull();
  });
});

describe("parseEventInput — gcalEventId", () => {
  const base = {
    name: "Robot Demo",
    periodId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T20:00:00Z",
  };

  test("defaults to null when absent", () => {
    expect(parseEventInput(base)?.gcalEventId).toBeNull();
  });

  test("carries a non-empty string through, trimmed", () => {
    expect(parseEventInput({ ...base, gcalEventId: " evt-42 " })?.gcalEventId).toBe("evt-42");
  });

  test("blank/non-string gcalEventId is treated as absent", () => {
    expect(parseEventInput({ ...base, gcalEventId: "" })?.gcalEventId).toBeNull();
    expect(parseEventInput({ ...base, gcalEventId: 5 })?.gcalEventId).toBeNull();
  });
});

describe("createEvent — linked to a calendar event", () => {
  function fakeDb(opts: {
    meeting: { title: string; starts_at: string; ends_at: string } | null;
    captured?: { row?: Record<string, unknown> };
  }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.meeting, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            insert: (row: Record<string, unknown>) => {
              if (opts.captured) opts.captured.row = row;
              return {
                select: () => ({
                  single: async () => ({ data: { id: "new-event" }, error: null }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  const input = {
    name: "Client-supplied name (should be ignored)",
    periodId: "11111111-1111-1111-1111-111111111111",
    location: null,
    description: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T01:00:00.000Z",
    gcalEventId: "evt-42",
    formId: null,
  };

  test("resolves name/starts_at/ends_at from the matching meeting, ignoring client text", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const db = fakeDb({
      meeting: { title: "Scouting Trip", starts_at: "2027-05-01T14:00:00.000Z", ends_at: "2027-05-01T18:00:00.000Z" },
      captured,
    });
    const result = await createEvent(input, "creator-1", db);
    expect(result).toEqual({ ok: true, id: "new-event" });
    expect(captured.row?.name).toBe("Scouting Trip");
    expect(captured.row?.starts_at).toBe("2027-05-01T14:00:00.000Z");
    expect(captured.row?.ends_at).toBe("2027-05-01T18:00:00.000Z");
  });

  test("400s when gcalEventId doesn't match any meeting", async () => {
    const db = fakeDb({ meeting: null });
    const result = await createEvent(input, "creator-1", db);
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("409s on a unique-constraint violation (two people linking the same calendar event)", async () => {
    const db = {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { title: "Scouting Trip", starts_at: "2027-05-01T14:00:00.000Z", ends_at: "2027-05-01T18:00:00.000Z" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { code: "23505" } }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
    const result = await createEvent(input, "creator-1", db);
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

describe("updateEvent", () => {
  function fakeDb(opts: {
    meeting?: { title: string; starts_at: string; ends_at: string } | null;
    updateError?: { code: string } | null;
    found?: boolean;
    captured?: { patch?: Record<string, unknown> };
  }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.meeting ?? null, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            update: (patch: Record<string, unknown>) => {
              if (opts.captured) opts.captured.patch = patch;
              return {
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () =>
                      opts.updateError
                        ? { data: null, error: opts.updateError }
                        : { data: opts.found === false ? null : { id: "ev1" }, error: null },
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  const input = {
    name: "Some Name",
    periodId: "11111111-1111-1111-1111-111111111111",
    location: null,
    description: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T01:00:00.000Z",
    gcalEventId: null,
    formId: null,
  };

  test("always writes gcal_missing: false, resetting any stale flag", async () => {
    const captured: { patch?: Record<string, unknown> } = {};
    const db = fakeDb({ captured });
    const result = await updateEvent("ev1", input, db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(captured.patch?.gcal_missing).toBe(false);
  });

  test("409s on a unique-constraint violation", async () => {
    const db = fakeDb({ updateError: { code: "23505" } });
    const result = await updateEvent("ev1", input, db);
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

describe("listGcalCandidates", () => {
  function fakeDb(opts: {
    meetings: { gcal_event_id: string; title: string; starts_at: string; ends_at: string }[];
    claimed: string[];
  }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              gte: () => ({
                order: async () => ({ data: opts.meetings, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            select: () => ({
              not: async () => ({ data: opts.claimed.map((id) => ({ gcal_event_id: id })), error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("excludes meetings already claimed by another event", async () => {
    const db = fakeDb({
      meetings: [
        { gcal_event_id: "evt-1", title: "Scouting Trip", starts_at: "2027-05-01T14:00:00Z", ends_at: "2027-05-01T18:00:00Z" },
        { gcal_event_id: "evt-2", title: "Regular Meeting", starts_at: "2027-05-08T23:00:00Z", ends_at: "2027-05-09T01:00:00Z" },
      ],
      claimed: ["evt-2"],
    });
    const candidates = await listGcalCandidates(db);
    expect(candidates).toEqual([
      { id: "evt-1", title: "Scouting Trip", startsAt: "2027-05-01T14:00:00Z", endsAt: "2027-05-01T18:00:00Z" },
    ]);
  });
});

describe("unlinkEvent", () => {
  function fakeDb(opts: { found: boolean }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: opts.found ? { id: "ev1" } : null, error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("404 when the event is missing", async () => {
    expect(await unlinkEvent("ev1", fakeDb({ found: false }))).toEqual({ ok: false, status: 404 });
  });

  test("ok when found", async () => {
    expect(await unlinkEvent("ev1", fakeDb({ found: true }))).toEqual({ ok: true, status: 200 });
  });
});

describe("deleteEvent", () => {
  function fakeDb(opts: { eventExists: boolean; sessionCount: number }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.eventExists ? { id: "ev1" } : null,
                  error: null,
                }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "session") {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({
                  data: opts.sessionCount > 0 ? [{ id: "s1" }] : [],
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

  test("404 when the event is missing", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: false, sessionCount: 0 })))
      .toEqual({ ok: false, status: 404 });
  });

  test("409 when the event has check-ins (don't silently delete history)", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: true, sessionCount: 1 })))
      .toEqual({ ok: false, status: 409 });
  });

  test("ok when the event has no check-ins", async () => {
    expect(await deleteEvent("ev1", fakeDb({ eventExists: true, sessionCount: 0 })))
      .toEqual({ ok: true, status: 200 });
  });
});

describe("createEvent — Slack hook never changes the result", () => {
  function fakeDb(opts: {
    meeting?: { title: string; starts_at: string; ends_at: string } | null;
    creatorSlackId?: string | null;
    captured?: { updatePatch?: Record<string, unknown> };
  }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.meeting ?? null, error: null }),
              }),
            }),
          };
        }
        if (table === "event") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "new-event" }, error: null }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              if (opts.captured) opts.captured.updatePatch = patch;
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === "person") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { slack_user_id: opts.creatorSlackId ?? null }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  const input = {
    name: "Client-supplied name (should be ignored)",
    periodId: "11111111-1111-1111-1111-111111111111",
    location: "Gym",
    description: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T01:00:00.000Z",
    gcalEventId: "evt-42",
    formId: null,
  };

  test("event is still created and the id returned even when every Slack call throws", async () => {
    const db = fakeDb({
      meeting: { title: "Scouting Trip", starts_at: "2027-05-01T14:00:00.000Z", ends_at: "2027-05-01T18:00:00.000Z" },
      creatorSlackId: "U123",
    });
    const result = await createEvent(input, "creator-1", db, throwingSlack);
    expect(result).toEqual({ ok: true, id: "new-event" });
  });

  test("passes the RESOLVED (gcal-derived) name to the Slack channel, not the raw client name", async () => {
    const captured: { updatePatch?: Record<string, unknown> } = {};
    const requests: { url: string; init?: RequestInit }[] = [];
    const workingSlack: SlackDeps = {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        if (String(url).includes("conversations.create")) {
          return new Response(JSON.stringify({ ok: true, channel: { id: "C123" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
      token: "xoxb-test",
      isProd: true,
    };
    const db = fakeDb({
      meeting: { title: "Scouting Trip", starts_at: "2027-05-01T14:00:00.000Z", ends_at: "2027-05-01T18:00:00.000Z" },
      captured,
    });
    const result = await createEvent(input, "creator-1", db, workingSlack);
    expect(result).toEqual({ ok: true, id: "new-event" });
    const createReq = requests.find((r) => r.url.includes("conversations.create"));
    const body = JSON.parse(createReq!.init!.body as string) as { name: string };
    // "Scouting Trip" (the meeting title), not "Client-supplied name (should be ignored)"
    expect(body.name).toBe("e-scouting-trip");
    expect(captured.updatePatch?.slack_channel_name).toBe("e-scouting-trip");
  });
});

describe("updateEvent — Slack hook never changes the result", () => {
  function fakeDb(opts: { slackChannelId: string | null; slackChannelName: string | null; slackArchivedAt: string | null }) {
    return {
      from(table: string) {
        if (table === "meeting") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        if (table === "event") {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "ev1",
                      slack_channel_id: opts.slackChannelId,
                      slack_channel_name: opts.slackChannelName,
                      slack_archived_at: opts.slackArchivedAt,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  const input = {
    name: "New Name",
    periodId: "11111111-1111-1111-1111-111111111111",
    location: null,
    description: null,
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2027-01-01T01:00:00.000Z",
    gcalEventId: null,
    formId: null,
  };

  test("update still succeeds when the channel rename throws", async () => {
    const db = fakeDb({ slackChannelId: "C1", slackChannelName: "e-old-name", slackArchivedAt: null });
    const result = await updateEvent("ev1", input, db, throwingSlack);
    expect(result).toEqual({ ok: true, status: 200 });
  });
});

describe("deleteEvent — Slack hook never changes the result", () => {
  function fakeDb(opts: { slackChannelId: string | null }) {
    return {
      from(table: string) {
        if (table === "event") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: "ev1", slack_channel_id: opts.slackChannelId }, error: null }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "session") {
          return { select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("delete still succeeds when archiving the channel throws", async () => {
    const db = fakeDb({ slackChannelId: "C1" });
    const result = await deleteEvent("ev1", db, throwingSlack);
    expect(result).toEqual({ ok: true, status: 200 });
  });
});

test("parseEventInput accepts an optional formId", () => {
  const base = { name: "Demo", periodId: "11111111-1111-1111-1111-111111111111",
    location: "Gym", description: "d", startsAt: "2099-01-01T18:00:00Z", endsAt: "2099-01-01T20:00:00Z" };
  expect(parseEventInput({ ...base })?.formId).toBeNull();
  expect(parseEventInput({ ...base, formId: "22222222-2222-2222-2222-222222222222" })?.formId)
    .toBe("22222222-2222-2222-2222-222222222222");
  expect(parseEventInput({ ...base, formId: "not-a-uuid" })).toBeNull();
});

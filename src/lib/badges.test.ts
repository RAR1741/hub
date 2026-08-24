import { describe, expect, test } from "vitest";
import {
  awardBadge,
  canAwardBadge,
  createBadge,
  parseAwardBadgeInput,
  parseBadgeInput,
  revokeBadgeAward,
} from "./badges";
import type { BadgeInput } from "./badges";
import type { Badge } from "./types";

const FULL_INPUT: Record<string, unknown> = {
  name: "Soldering",
  category: "Safety",
  description: "Can safely solder a joint",
  color: "#112233",
  teamId: "11111111-1111-1111-1111-111111111111",
  allowSelfAward: true,
};

describe("parseBadgeInput", () => {
  test("accepts a full valid payload", () => {
    expect(parseBadgeInput(FULL_INPUT)).toEqual({
      name: "Soldering",
      category: "Safety",
      description: "Can safely solder a joint",
      color: "#112233",
      teamId: "11111111-1111-1111-1111-111111111111",
      allowSelfAward: true,
    });
  });

  test("accepts a minimal valid payload", () => {
    expect(
      parseBadgeInput({ name: "Solo", color: "#ffffff", allowSelfAward: false }),
    ).toEqual({
      name: "Solo",
      category: null,
      description: null,
      color: "#ffffff",
      teamId: null,
      allowSelfAward: false,
    });
  });

  test.each([
    [{ color: "#ffffff", allowSelfAward: false }], // missing name
    [{ name: "X", color: "red", allowSelfAward: false }], // bad color
    [{ name: "x".repeat(81), color: "#ffffff", allowSelfAward: false }], // name too long
    [{ name: "X", category: "y".repeat(81), color: "#ffffff", allowSelfAward: false }], // category too long
    [{ name: "X", color: "#ffffff" }], // missing allowSelfAward
    [null],
  ])("rejects %j", (body) => {
    expect(parseBadgeInput(body)).toBeNull();
  });
});

describe("parseAwardBadgeInput", () => {
  test("accepts a valid payload", () => {
    expect(
      parseAwardBadgeInput({
        badgeId: "11111111-1111-1111-1111-111111111111",
        note: " great work ",
      }),
    ).toEqual({
      badgeId: "11111111-1111-1111-1111-111111111111",
      note: "great work",
    });
  });

  test("accepts a valid payload with no note", () => {
    expect(
      parseAwardBadgeInput({ badgeId: "11111111-1111-1111-1111-111111111111" }),
    ).toEqual({ badgeId: "11111111-1111-1111-1111-111111111111", note: null });
  });

  test.each([
    [{ badgeId: "not-a-uuid" }],
    [{ badgeId: "11111111-1111-1111-1111-111111111111", note: "x".repeat(301) }],
    [{}],
    [null],
  ])("rejects %j", (body) => {
    expect(parseAwardBadgeInput(body)).toBeNull();
  });
});

describe("canAwardBadge", () => {
  const selfAwardable: Badge = {
    id: "b1",
    name: "Soldering",
    category: null,
    description: null,
    color: "#6b7280",
    teamId: null,
    allowSelfAward: true,
    createdBy: "admin1",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const notSelfAwardable: Badge = { ...selfAwardable, allowSelfAward: false };

  test("mentor can always award, regardless of self-award flag or target", () => {
    expect(canAwardBadge("mentor", "p1", "p2", notSelfAwardable)).toBe(true);
    expect(canAwardBadge("mentor", "p1", "p1", notSelfAwardable)).toBe(true);
  });

  test("student awarding self a self-awardable badge succeeds", () => {
    expect(canAwardBadge("student", "p1", "p1", selfAwardable)).toBe(true);
  });

  test("student awarding self a non-self-awardable badge fails", () => {
    expect(canAwardBadge("student", "p1", "p1", notSelfAwardable)).toBe(false);
  });

  test("student awarding someone else fails", () => {
    expect(canAwardBadge("student", "p1", "p2", selfAwardable)).toBe(false);
  });

  test("admin awarding someone else succeeds", () => {
    expect(canAwardBadge("admin", "p1", "p2", notSelfAwardable)).toBe(true);
  });
});

describe("createBadge", () => {
  const input: BadgeInput = {
    name: "Soldering",
    category: null,
    description: null,
    color: "#6b7280",
    teamId: null,
    allowSelfAward: false,
  };

  function fakeDb(result: { data?: { id: string } | null; error: { code: string } | null }) {
    return {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => result,
          }),
        }),
      }),
    } as never;
  }

  test("ok on successful insert", async () => {
    const result = await createBadge(input, "creator1", fakeDb({ data: { id: "b1" }, error: null }));
    expect(result).toEqual({ ok: true, id: "b1" });
  });

  test("409 on duplicate name (23505)", async () => {
    const result = await createBadge(input, "creator1", fakeDb({ data: null, error: { code: "23505" } }));
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("500 on other errors", async () => {
    const result = await createBadge(input, "creator1", fakeDb({ data: null, error: { code: "99999" } }));
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("awardBadge", () => {
  function fakeDb(opts: {
    badge: { team_id: string | null } | null;
    membership?: { team_id: string } | null;
    insertError?: { code: string } | null;
  }) {
    return {
      from: (table: string) => {
        if (table === "badge") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.badge, error: null }),
              }),
            }),
          };
        }
        if (table === "team_membership") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: opts.membership ?? null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "badge_award") {
          return {
            insert: async () => ({ error: opts.insertError ?? null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }

  test("ok/201 on successful award (no team scope)", async () => {
    const result = await awardBadge("b1", "p1", "awarder1", null, fakeDb({ badge: { team_id: null } }));
    expect(result).toEqual({ ok: true, status: 201 });
  });

  test("404 when the badge is missing", async () => {
    const result = await awardBadge("missing", "p1", "awarder1", null, fakeDb({ badge: null }));
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("409 when team-scoped and the person lacks that team's membership", async () => {
    const result = await awardBadge(
      "b1",
      "p1",
      "awarder1",
      null,
      fakeDb({ badge: { team_id: "t1" }, membership: null }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("team-scoped succeeds when the person is a member of that team", async () => {
    const result = await awardBadge(
      "b1",
      "p1",
      "awarder1",
      null,
      fakeDb({ badge: { team_id: "t1" }, membership: { team_id: "t1" } }),
    );
    expect(result).toEqual({ ok: true, status: 201 });
  });

  test("409 on duplicate award (23505)", async () => {
    const result = await awardBadge(
      "b1",
      "p1",
      "awarder1",
      null,
      fakeDb({ badge: { team_id: null }, insertError: { code: "23505" } }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("500 on other insert errors", async () => {
    const result = await awardBadge(
      "b1",
      "p1",
      "awarder1",
      null,
      fakeDb({ badge: { team_id: null }, insertError: { code: "99999" } }),
    );
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("revokeBadgeAward", () => {
  function fakeDb(rows: { id: string }[]) {
    return {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    } as never;
  }

  test("200 when a row is deleted", async () => {
    const result = await revokeBadgeAward("b1", "p1", fakeDb([{ id: "a1" }]));
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("404 when no matching award existed", async () => {
    const result = await revokeBadgeAward("b1", "p1", fakeDb([]));
    expect(result).toEqual({ ok: false, status: 404 });
  });
});

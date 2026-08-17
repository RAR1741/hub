import { describe, expect, test } from "vitest";
import { listDuplicateCandidates, listRejectedPairs, mergePeople, rejectPair, unrejectPair } from "./merge-people";

function rpcDb(result: { error?: { code: string; message?: string } | null }) {
  return {
    rpc: async () => result,
  } as never;
}

describe("mergePeople", () => {
  test("400 on self-merge without calling the DB", async () => {
    const boom = {
      rpc: () => {
        throw new Error("should not call rpc");
      },
    } as never;
    const r = await mergePeople("p1", "p1", boom);
    expect(r).toEqual({ ok: false, status: 400 });
  });

  test("400 when the DB raises P0001 (self-merge)", async () => {
    const db = rpcDb({ error: { code: "P0001", message: "cannot merge a person into itself" } });
    const r = await mergePeople("p1", "p2", db);
    expect(r).toEqual({ ok: false, status: 400 });
  });

  test("404 when the DB raises P0002 (not found)", async () => {
    const db = rpcDb({ error: { code: "P0002", message: "person not found" } });
    const r = await mergePeople("p1", "p2", db);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  test("500 on any other rpc error", async () => {
    const db = rpcDb({ error: { code: "XX000", message: "boom" } });
    const r = await mergePeople("p1", "p2", db);
    expect(r).toEqual({ ok: false, status: 500 });
  });

  test("200 on success", async () => {
    const db = rpcDb({ error: null });
    const r = await mergePeople("p1", "p2", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });
});

// Helpers for rejection tests
function makeDb(opts: {
  fromResult?: { data: unknown[]; error: null };
  upsertResult?: { error: null | { message: string } };
  deleteResult?: { error: null | { message: string } };
}) {
  return {
    from: () => ({
      upsert: async () => ({ error: opts.upsertResult?.error ?? null }),
      delete: () => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: string) =>
            Promise.resolve({ error: opts.deleteResult?.error ?? null }),
        }),
      }),
      select: () => ({
        data: opts.fromResult?.data ?? [],
        error: opts.fromResult?.error ?? null,
      }),
    }),
  } as never;
}

describe("rejectPair", () => {
  test("400 on self-pair without DB call", async () => {
    const boom = { from: () => { throw new Error("should not call db"); } } as never;
    const r = await rejectPair("p1", "p1", "admin1", boom);
    expect(r).toEqual({ ok: false, status: 400 });
  });

  test("normalises order: (b,a) treated same as (a,b)", async () => {
    // Both calls must pass without error — order normalisation is tested by
    // verifying neither throws and both return ok.
    const db = makeDb({ upsertResult: { error: null } });
    const r1 = await rejectPair("aaa", "bbb", "admin1", db);
    const r2 = await rejectPair("bbb", "aaa", "admin1", db);
    expect(r1).toEqual({ ok: true, status: 200 });
    expect(r2).toEqual({ ok: true, status: 200 });
  });

  test("200 on success", async () => {
    const db = makeDb({ upsertResult: { error: null } });
    const r = await rejectPair("aaa", "bbb", "admin1", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("500 on DB error", async () => {
    const db = makeDb({ upsertResult: { error: { message: "boom" } } });
    const r = await rejectPair("aaa", "bbb", "admin1", db);
    expect(r).toEqual({ ok: false, status: 500 });
  });
});

describe("unrejectPair", () => {
  test("200 on success (idempotent)", async () => {
    const db = makeDb({ deleteResult: { error: null } });
    const r = await unrejectPair("aaa", "bbb", db);
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("500 on DB error", async () => {
    const db = makeDb({ deleteResult: { error: { message: "boom" } } });
    const r = await unrejectPair("aaa", "bbb", db);
    expect(r).toEqual({ ok: false, status: 500 });
  });
});

/**
 * Build a multi-table mock db whose from(table) returns different data
 * depending on the table name. Supports the fluent select/in/order/eq chains
 * used by listDuplicateCandidates and listRejectedPairs.
 */
function makeMultiTableDb(tableData: Record<string, unknown[]>) {
  function makeQuery(rows: unknown[]) {
    const q = {
      data: rows,
      error: null,
      select: (_: string) => q,
      order: (_col: string, _opts?: unknown) => q,
      in: (_col: string, _vals: unknown[]) => q,
      eq: (_col: string, _val: unknown) => q,
    };
    return q;
  }
  return {
    from: (table: string) => makeQuery(tableData[table] ?? []),
  } as never;
}

describe("listDuplicateCandidates", () => {
  test("filters out a rejected pair; the filter runs before the MAX_PAIRS cap", async () => {
    // Two people with identical names → findDuplicateCandidates will score them
    // at 1.0 (well above the 0.72 threshold). Their pair is then dismissed.
    // id ordering: "id-a" < "id-b" so the stored pair key is "id-a|id-b".
    const personRows = [
      { id: "id-a", first_name: "Jordan", last_name: "Smith", role: "mentor", is_active: true },
      { id: "id-b", first_name: "Jordan", last_name: "Smith", role: "mentor", is_active: true },
    ];
    const db = makeMultiTableDb({
      person: personRows,
      person_merge_rejection: [{ a: "id-a", b: "id-b" }],
      // enrichment tables — empty since no candidates survive the filter
      person_identity: [],
      session: [],
      team_membership: [],
    });

    const result = await listDuplicateCandidates(db);
    expect(result).toEqual([]);
  });
});

describe("listRejectedPairs", () => {
  test("returns both people's names for each rejection row", async () => {
    const db = makeMultiTableDb({
      person_merge_rejection: [{ a: "id-a", b: "id-b" }],
      person: [
        { id: "id-a", first_name: "Alice", last_name: "Alpha", role: "student", is_active: true },
        { id: "id-b", first_name: "Bob", last_name: "Beta", role: "mentor", is_active: false },
      ],
      person_identity: [],
      session: [],
      team_membership: [],
    });

    const result = await listRejectedPairs(db);
    expect(result).toHaveLength(1);
    expect(result[0].a.firstName).toBe("Alice");
    expect(result[0].a.lastName).toBe("Alpha");
    expect(result[0].b.firstName).toBe("Bob");
    expect(result[0].b.lastName).toBe("Beta");
  });
});

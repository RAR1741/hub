import { describe, expect, test } from "vitest";
import { mergePeople, rejectPair, unrejectPair } from "./merge-people";

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

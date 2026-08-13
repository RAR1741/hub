import { describe, expect, test } from "vitest";
import {
  createExcusalRequest,
  parseExcusalRequestInput,
  reviewExcusalRequest,
} from "./excusal-requests";

describe("parseExcusalRequestInput", () => {
  test("accepts a valid date with no reason", () => {
    expect(parseExcusalRequestInput({ date: "2026-09-01" })).toEqual({
      date: "2026-09-01",
      reason: null,
    });
  });

  test("accepts a valid date with a trimmed reason", () => {
    expect(
      parseExcusalRequestInput({ date: "2026-09-01", reason: " doctor appt " }),
    ).toEqual({ date: "2026-09-01", reason: "doctor appt" });
  });

  test.each([
    [{}],
    [{ date: "not-a-date" }],
    [{ date: "2026-13-40" }],
    [{ date: "2026-09-01", reason: "x".repeat(501) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseExcusalRequestInput(body)).toBeNull();
  });
});

describe("createExcusalRequest", () => {
  function fakeDb(result: { error: { code: string } | null }) {
    return {
      from: () => ({
        insert: async () => result,
      }),
    } as never;
  }

  test("ok on successful insert", async () => {
    const result = await createExcusalRequest(
      "p1",
      { date: "2026-09-01", reason: null },
      fakeDb({ error: null }),
    );
    expect(result).toEqual({ ok: true, status: 201 });
  });

  test("409 on duplicate pending request for that date (23505)", async () => {
    const result = await createExcusalRequest(
      "p1",
      { date: "2026-09-01", reason: null },
      fakeDb({ error: { code: "23505" } }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("500 on other errors", async () => {
    const result = await createExcusalRequest(
      "p1",
      { date: "2026-09-01", reason: null },
      fakeDb({ error: { code: "99999" } }),
    );
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("reviewExcusalRequest", () => {
  type Row = {
    id: string;
    person_id: string;
    date: string;
    reason: string | null;
    status: string;
  };

  function fakeDb(opts: {
    request: Row | null;
    fetchError?: { code: string } | null;
    excusalError?: { code: string } | null;
    updateError?: { code: string } | null;
    updateNoRow?: boolean;
  }) {
    const calls: { excusalInsert?: unknown; requestUpdate?: unknown } = {};
    return {
      db: {
        from: (table: string) => {
          if (table === "excusal_request") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: opts.fetchError ? null : opts.request,
                    error: opts.fetchError ?? null,
                  }),
                }),
              }),
              update: (patch: unknown) => {
                calls.requestUpdate = patch;
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data:
                            opts.updateError || opts.updateNoRow
                              ? null
                              : { id: opts.request?.id ?? "r1" },
                          error: opts.updateError ?? null,
                        }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === "excusal") {
            return {
              upsert: async (input: unknown) => {
                calls.excusalInsert = input;
                return { error: opts.excusalError ?? null };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      } as never,
      calls,
    };
  }

  test("approve: creates the excusal and marks approved", async () => {
    const { db, calls } = fakeDb({
      request: { id: "r1", person_id: "p1", date: "2026-09-01", reason: "sick", status: "pending" },
    });
    const result = await reviewExcusalRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls.excusalInsert).toMatchObject({
      person_id: "p1",
      date: "2026-09-01",
      note: "sick",
      created_by: "reviewer1",
    });
    expect(calls.requestUpdate).toMatchObject({
      status: "approved",
      reviewed_by: "reviewer1",
    });
  });

  test("deny: marks denied without creating an excusal", async () => {
    const { db, calls } = fakeDb({
      request: { id: "r1", person_id: "p1", date: "2026-09-01", reason: null, status: "pending" },
    });
    const result = await reviewExcusalRequest("r1", "deny", "reviewer1", db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls.excusalInsert).toBeUndefined();
    expect(calls.requestUpdate).toMatchObject({
      status: "denied",
      reviewed_by: "reviewer1",
    });
  });

  test("404 when the request is missing", async () => {
    const { db } = fakeDb({ request: null });
    const result = await reviewExcusalRequest("missing", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("409 when the request was already decided", async () => {
    const { db } = fakeDb({
      request: { id: "r1", person_id: "p1", date: "2026-09-01", reason: null, status: "approved" },
    });
    const result = await reviewExcusalRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("surfaces a failed excusal insert as non-ok", async () => {
    const { db } = fakeDb({
      request: { id: "r1", person_id: "p1", date: "2026-09-01", reason: null, status: "pending" },
      excusalError: { code: "99999" },
    });
    const result = await reviewExcusalRequest("r1", "approve", "reviewer1", db);
    expect(result.ok).toBe(false);
  });

  test("500 when the request fetch itself errors", async () => {
    const { db } = fakeDb({ request: null, fetchError: { code: "57014" } });
    const result = await reviewExcusalRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 500 });
  });

  test("409 when a concurrent reviewer already flipped the guarded update", async () => {
    const { db } = fakeDb({
      request: { id: "r1", person_id: "p1", date: "2026-09-01", reason: null, status: "pending" },
      updateNoRow: true,
    });
    const result = await reviewExcusalRequest("r1", "deny", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

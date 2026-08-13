import { describe, expect, test } from "vitest";
import { approveAccountRequest, approveApplication, parseApproval } from "./requests";

describe("parseApproval", () => {
  test("accepts student ID with default role student", () => {
    expect(parseApproval({ studentIdNumber: " 1742 " })).toEqual({
      studentIdNumber: "1742",
      role: "student",
    });
  });
  test.each([
    [{}],
    [{ studentIdNumber: "" }],
    [{ studentIdNumber: "ok", role: "admin" }],
    [{ studentIdNumber: "ok", role: "captain" }], // captain role removed — no longer approvable
    [{ studentIdNumber: "x".repeat(65) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseApproval(body)).toBeNull();
  });
});

describe("approveAccountRequest", () => {
  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    grad_year: number | null;
    email: string | null;
    status: string;
    created_at: string;
  };

  const pendingRow: Row = {
    id: "r1",
    first_name: "A",
    last_name: "B",
    grad_year: 2028,
    email: "a@b.com",
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
  };

  function fakeDb(opts: {
    request: Row | null;
    createError?: { code: string } | null;
    updateData?: unknown;
    updateError?: { code: string } | null;
  }) {
    const calls: { requestUpdate?: unknown } = {};
    return {
      db: {
        from: (table: string) => {
          if (table === "account_request") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: opts.request, error: null }),
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
                          data: opts.updateData !== undefined ? opts.updateData : { id: "r1" },
                          error: opts.updateError ?? null,
                        }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === "person") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: opts.createError ? undefined : { id: "newperson1" },
                    error: opts.createError ?? null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      } as never,
      calls,
    };
  }

  test("approve: creates the person and marks approved", async () => {
    const { db, calls } = fakeDb({ request: pendingRow });
    const result = await approveAccountRequest(
      "r1",
      { studentIdNumber: "42", role: "student" },
      "reviewer1",
      db,
    );
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls.requestUpdate).toMatchObject({ status: "approved", reviewed_by: "reviewer1" });
  });

  test("404 when the request is missing or not pending", async () => {
    const { db } = fakeDb({ request: null });
    const result = await approveAccountRequest(
      "missing",
      { studentIdNumber: "42", role: "student" },
      "reviewer1",
      db,
    );
    expect(result).toEqual({ ok: false, status: 404 });
  });

  // The initial fetch is guarded on status = pending, but that only protects
  // the READ. Without the same guard on the final UPDATE, a second reviewer
  // (or a retried request) whose decision lands in the race window between
  // this fetch and this write would silently report success even though the
  // request had already been decided by someone else in the meantime.
  test("409 when a concurrent reviewer already decided the request before this write lands", async () => {
    const { db } = fakeDb({ request: pendingRow, updateData: null });
    const result = await approveAccountRequest(
      "r1",
      { studentIdNumber: "42", role: "student" },
      "reviewer1",
      db,
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

describe("approveApplication", () => {
  function fakeDb(opts: {
    app: { id: string; person_id: string; team_id: string } | null;
    membershipError?: { code: string } | null;
    updateData?: unknown;
    updateError?: { code: string } | null;
  }) {
    const calls: { appUpdate?: unknown } = {};
    return {
      db: {
        from: (table: string) => {
          if (table === "membership_application") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: opts.app, error: null }),
                  }),
                }),
              }),
              update: (patch: unknown) => {
                calls.appUpdate = patch;
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: opts.updateData !== undefined ? opts.updateData : { id: "a1" },
                          error: opts.updateError ?? null,
                        }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === "team_membership") {
            return {
              upsert: async () => ({ error: opts.membershipError ?? null }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      } as never,
      calls,
    };
  }

  test("approve: creates the membership and marks approved", async () => {
    const { db, calls } = fakeDb({ app: { id: "a1", person_id: "p1", team_id: "t1" } });
    const result = await approveApplication("a1", "reviewer1", db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls.appUpdate).toMatchObject({ status: "approved", reviewed_by: "reviewer1" });
  });

  test("404 when the application is missing or not pending", async () => {
    const { db } = fakeDb({ app: null });
    const result = await approveApplication("missing", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("409 when a concurrent reviewer already decided the application before this write lands", async () => {
    const { db } = fakeDb({
      app: { id: "a1", person_id: "p1", team_id: "t1" },
      updateData: null,
    });
    const result = await approveApplication("a1", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 409 });
  });
});

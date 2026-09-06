import { beforeEach, describe, expect, test, vi } from "vitest";
import { deleteTool } from "./tools";

vi.mock("./tools", () => ({
  deleteTool: vi.fn(),
}));

import {
  createToolDeleteRequest,
  parseToolDeleteRequestInput,
  reviewToolDeleteRequest,
} from "./tool-delete-requests";

const mockDeleteTool = vi.mocked(deleteTool);
const TOOL_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockDeleteTool.mockReset();
});

describe("parseToolDeleteRequestInput", () => {
  test("accepts a valid toolId and reason", () => {
    expect(parseToolDeleteRequestInput({ toolId: TOOL_ID, reason: " broken " })).toEqual({
      toolId: TOOL_ID,
      reason: "broken",
    });
  });

  test.each([
    [{}],
    [{ toolId: TOOL_ID }],
    [{ toolId: "not-a-uuid", reason: "x" }],
    [{ toolId: TOOL_ID, reason: "" }],
    [{ toolId: TOOL_ID, reason: "x".repeat(501) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseToolDeleteRequestInput(body)).toBeNull();
  });
});

describe("createToolDeleteRequest", () => {
  function fakeDb(result: { data: { id: string } | null; error: { code: string } | null }) {
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

  test("ok returns id on successful insert", async () => {
    const result = await createToolDeleteRequest(
      "p1",
      { toolId: TOOL_ID, reason: "broken" },
      fakeDb({ data: { id: "req1" }, error: null }),
    );
    expect(result).toEqual({ ok: true, id: "req1" });
  });

  test("409 on duplicate pending request for that tool (23505)", async () => {
    const result = await createToolDeleteRequest(
      "p1",
      { toolId: TOOL_ID, reason: "broken" },
      fakeDb({ data: null, error: { code: "23505" } }),
    );
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("400 on unknown tool (23503)", async () => {
    const result = await createToolDeleteRequest(
      "p1",
      { toolId: TOOL_ID, reason: "broken" },
      fakeDb({ data: null, error: { code: "23503" } }),
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("500 on other errors", async () => {
    const result = await createToolDeleteRequest(
      "p1",
      { toolId: TOOL_ID, reason: "broken" },
      fakeDb({ data: null, error: { code: "99999" } }),
    );
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

describe("reviewToolDeleteRequest", () => {
  type Row = {
    id: string;
    tool_id: string;
    requested_by: string;
    reason: string;
    status: string;
  };

  function fakeDb(opts: {
    request: Row | null;
    fetchError?: { code: string } | null;
    updateError?: { code: string } | null;
    updateNoRow?: boolean;
  }) {
    const calls: { requestUpdate?: unknown } = {};
    return {
      db: {
        from: (table: string) => {
          if (table === "tool_delete_request") {
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
          throw new Error(`unexpected table ${table}`);
        },
      } as never,
      calls,
    };
  }

  test("approve: marks approved then deletes the tool (call order)", async () => {
    const order: string[] = [];
    const { db, calls } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "pending" },
    });
    // Track mark order via the update patch capture, and delete order via the mock.
    mockDeleteTool.mockImplementation(async () => {
      order.push("delete");
      return { ok: true };
    });
    const trackedDb = {
      from: (table: string) => {
        const t = (db as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        const orig = t.update as (patch: unknown) => unknown;
        return {
          ...t,
          update: (patch: unknown) => {
            order.push("mark");
            return orig(patch);
          },
        };
      },
    } as never;

    const result = await reviewToolDeleteRequest("r1", "approve", "reviewer1", trackedDb);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(order).toEqual(["mark", "delete"]);
    expect(calls.requestUpdate).toMatchObject({
      status: "approved",
      reviewed_by: "reviewer1",
    });
    expect(mockDeleteTool).toHaveBeenCalledWith(TOOL_ID, trackedDb);
  });

  test("deny: marks denied without deleting the tool", async () => {
    const { db, calls } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "pending" },
    });
    const result = await reviewToolDeleteRequest("r1", "deny", "reviewer1", db);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(mockDeleteTool).not.toHaveBeenCalled();
    expect(calls.requestUpdate).toMatchObject({
      status: "denied",
      reviewed_by: "reviewer1",
    });
  });

  test("404 when the request is missing", async () => {
    const { db } = fakeDb({ request: null });
    const result = await reviewToolDeleteRequest("missing", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 404 });
    expect(mockDeleteTool).not.toHaveBeenCalled();
  });

  test("409 when the request was already decided", async () => {
    const { db } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "approved" },
    });
    const result = await reviewToolDeleteRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 409 });
    expect(mockDeleteTool).not.toHaveBeenCalled();
  });

  test("500 when the request fetch itself errors", async () => {
    const { db } = fakeDb({ request: null, fetchError: { code: "57014" } });
    const result = await reviewToolDeleteRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 500 });
  });

  test("409 when a concurrent reviewer already flipped the guarded update", async () => {
    const { db } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "pending" },
      updateNoRow: true,
    });
    const result = await reviewToolDeleteRequest("r1", "deny", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 409 });
    expect(mockDeleteTool).not.toHaveBeenCalled();
  });

  test("approve: a 404 from deleteTool (raced deletion) is still ok", async () => {
    const { db } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "pending" },
    });
    mockDeleteTool.mockResolvedValue({ ok: false, status: 404 });
    const result = await reviewToolDeleteRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: true, status: 200 });
  });

  test("approve: a 500 from deleteTool is surfaced", async () => {
    const { db } = fakeDb({
      request: { id: "r1", tool_id: TOOL_ID, requested_by: "p1", reason: "broken", status: "pending" },
    });
    mockDeleteTool.mockResolvedValue({ ok: false, status: 500 });
    const result = await reviewToolDeleteRequest("r1", "approve", "reviewer1", db);
    expect(result).toEqual({ ok: false, status: 500 });
  });
});

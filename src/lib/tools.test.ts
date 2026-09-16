import { describe, expect, test } from "vitest";
import { createCheck, createTool, deleteTool, nextDueAt, parseCheckInput, parseToolInput, sortByLastChecked } from "./tools";

// ---- Generic Supabase query-builder stub (copied from batteries.test.ts) ----

type Result = { data: unknown; error: unknown };

class QueryStub implements PromiseLike<Result> {
  calls: { method: string; args: unknown[] }[] = [];
  constructor(private result: Result) {}
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }
  select(...args: unknown[]) {
    return this.record("select", args);
  }
  eq(...args: unknown[]) {
    return this.record("eq", args);
  }
  order(...args: unknown[]) {
    return this.record("order", args);
  }
  limit(...args: unknown[]) {
    return this.record("limit", args);
  }
  insert(...args: unknown[]) {
    return this.record("insert", args);
  }
  update(...args: unknown[]) {
    return this.record("update", args);
  }
  delete(...args: unknown[]) {
    return this.record("delete", args);
  }
  maybeSingle(): Promise<Result> {
    return Promise.resolve(this.result);
  }
  single(): Promise<Result> {
    return Promise.resolve(this.result);
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeDb(script: Record<string, Result[]>) {
  const stubs: Record<string, QueryStub[]> = {};
  const from = (table: string) => {
    const queue = script[table];
    const result = queue?.shift();
    if (!result) throw new Error(`unexpected call to table ${table}`);
    const stub = new QueryStub(result);
    (stubs[table] ??= []).push(stub);
    return stub;
  };
  return { db: { from } as never, stubs };
}

const TOOL_ID = "11111111-1111-1111-1111-111111111111";
const PERSON_ID = "22222222-2222-2222-2222-222222222222";

const validTool = {
  name: "Drill press",
  category: "machine",
  location: "Bench 3",
  assetTag: "DP-1",
  status: "in_service",
  maintenanceIntervalDays: 90,
  notes: "keep guard on",
};

describe("parseToolInput", () => {
  test("accepts a valid tool", () => {
    expect(parseToolInput(validTool)).toEqual({
      name: "Drill press",
      category: "machine",
      location: "Bench 3",
      assetTag: "DP-1",
      status: "in_service",
      maintenanceIntervalDays: 90,
      notes: "keep guard on",
    });
  });

  test("blank optionals become null", () => {
    expect(
      parseToolInput({ ...validTool, category: "", location: "", assetTag: "", notes: "", maintenanceIntervalDays: null }),
    ).toEqual(
      expect.objectContaining({
        category: null,
        location: null,
        assetTag: null,
        notes: null,
        maintenanceIntervalDays: null,
      }),
    );
  });

  test("rejects an empty name", () => {
    expect(parseToolInput({ ...validTool, name: "" })).toBeNull();
  });

  test("rejects an invalid status", () => {
    expect(parseToolInput({ ...validTool, status: "broken" })).toBeNull();
  });

  test("rejects maintenanceIntervalDays of 0", () => {
    expect(parseToolInput({ ...validTool, maintenanceIntervalDays: 0 })).toBeNull();
  });

  test("rejects maintenanceIntervalDays above 3650", () => {
    expect(parseToolInput({ ...validTool, maintenanceIntervalDays: 3651 })).toBeNull();
  });

  test("accepts every lifecycle status", () => {
    for (const status of ["in_service", "needs_attention", "out_of_service", "retired"]) {
      expect(parseToolInput({ ...validTool, status })?.status).toBe(status);
    }
  });

  test("rejects a non-object body", () => {
    expect(parseToolInput(null)).toBeNull();
  });
});

const validCheck = {
  toolId: TOOL_ID,
  checkedAt: "2026-09-01T10:00:00.000Z",
  kind: "inspection",
  condition: "good",
  statusAfter: null,
  notes: "looks fine",
};

describe("parseCheckInput", () => {
  test("accepts a valid check with statusAfter null", () => {
    expect(parseCheckInput(validCheck)).toEqual({
      toolId: TOOL_ID,
      checkedAt: "2026-09-01T10:00:00.000Z",
      kind: "inspection",
      condition: "good",
      statusAfter: null,
      notes: "looks fine",
    });
  });

  test("rejects statusAfter of retired", () => {
    expect(parseCheckInput({ ...validCheck, statusAfter: "retired" })).toBeNull();
  });

  test("accepts the three non-retired statusAfter values", () => {
    for (const statusAfter of ["in_service", "needs_attention", "out_of_service"]) {
      expect(parseCheckInput({ ...validCheck, statusAfter })?.statusAfter).toBe(statusAfter);
    }
  });

  test("rejects a bad kind", () => {
    expect(parseCheckInput({ ...validCheck, kind: "cleaning" })).toBeNull();
  });

  test("rejects a bad condition", () => {
    expect(parseCheckInput({ ...validCheck, condition: "terrible" })).toBeNull();
  });

  test("rejects a non-uuid toolId", () => {
    expect(parseCheckInput({ ...validCheck, toolId: "not-a-uuid" })).toBeNull();
  });

  test("checkedAt omitted defaults to now", () => {
    const before = Date.now();
    const result = parseCheckInput({ ...validCheck, checkedAt: undefined });
    const after = Date.now();
    expect(result).not.toBeNull();
    const parsed = Date.parse(result!.checkedAt);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  test("rejects a non-object body", () => {
    expect(parseCheckInput(null)).toBeNull();
  });
});

describe("nextDueAt", () => {
  const base = { maintenanceIntervalDays: null as number | null, status: "in_service" as const, createdAt: "2026-01-01T00:00:00.000Z" };

  test("no interval → null", () => {
    expect(nextDueAt({ ...base, maintenanceIntervalDays: null }, "2026-06-01T00:00:00.000Z")).toBeNull();
  });

  test("retired → null even with an interval", () => {
    expect(nextDueAt({ ...base, maintenanceIntervalDays: 30, status: "retired" }, "2026-06-01T00:00:00.000Z")).toBeNull();
  });

  test("never checked → tool.createdAt", () => {
    expect(nextDueAt({ ...base, maintenanceIntervalDays: 30 }, null)).toBe("2026-01-01T00:00:00.000Z");
  });

  test("checked → lastCheckedAt + interval days, exact ISO", () => {
    expect(nextDueAt({ ...base, maintenanceIntervalDays: 30 }, "2026-06-01T00:00:00.000Z")).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("sortByLastChecked", () => {
  function row(id: string, lastCheckedAt: string | null, status: "in_service" | "retired" = "in_service") {
    return { id, status, lastCheckedAt } as { id: string; status: "in_service" | "retired"; lastCheckedAt: string | null };
  }

  test("never-checked first, then oldest checked first, retired always last", () => {
    const neverChecked = row("never", null);
    const oldest = row("oldest", "2026-01-01T00:00:00.000Z");
    const newest = row("newest", "2026-06-01T00:00:00.000Z");
    const retiredNeverChecked = row("retired-never", null, "retired");
    const retiredRecentlyChecked = row("retired-checked", "2026-01-01T00:00:00.000Z", "retired");

    const sorted = sortByLastChecked([newest, retiredRecentlyChecked, oldest, retiredNeverChecked, neverChecked]);
    expect(sorted.map((r) => r.id)).toEqual(["never", "oldest", "newest", "retired-never", "retired-checked"]);
  });
});

describe("createTool", () => {
  test("maps a unique-violation (duplicate asset tag) to 409", async () => {
    const { db } = fakeDb({
      tool: [{ data: null, error: { code: "23505" } }],
    });
    const input = parseToolInput(validTool)!;
    expect(await createTool(input, db)).toEqual({ ok: false, status: 409 });
  });

  test("returns the new id on success", async () => {
    const { db } = fakeDb({
      tool: [{ data: { id: "tool-1" }, error: null }],
    });
    const input = parseToolInput(validTool)!;
    expect(await createTool(input, db)).toEqual({ ok: true, id: "tool-1" });
  });
});

describe("createCheck", () => {
  test("maps a foreign-key violation (unknown tool) to 400", async () => {
    const { db } = fakeDb({
      tool_check: [{ data: null, error: { code: "23503" } }],
    });
    const input = parseCheckInput(validCheck)!;
    expect(await createCheck(input, PERSON_ID, db)).toEqual({ ok: false, status: 400 });
  });

  test("returns the new id on success", async () => {
    const { db } = fakeDb({
      tool_check: [{ data: { id: "check-1" }, error: null }],
    });
    const input = parseCheckInput(validCheck)!;
    expect(await createCheck(input, PERSON_ID, db)).toEqual({ ok: true, id: "check-1" });
  });
});

describe("deleteTool", () => {
  test("no row → 404", async () => {
    const { db } = fakeDb({
      tool: [{ data: null, error: null }],
    });
    expect(await deleteTool(TOOL_ID, db)).toEqual({ ok: false, status: 404 });
  });

  test("deletes and returns ok on success", async () => {
    const { db } = fakeDb({
      tool: [
        { data: { id: TOOL_ID }, error: null },
        { data: null, error: null },
      ],
    });
    expect(await deleteTool(TOOL_ID, db)).toEqual({ ok: true });
  });
});

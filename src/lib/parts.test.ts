import { describe, expect, test } from "vitest";
import type { Part } from "./types";
import {
  countPartsByProject,
  createPart,
  deletePart,
  deleteProject,
  parsePartInput,
  parsePartPatch,
  parseProjectInput,
  partAncestors,
  sortParts,
} from "./parts";

// ---- Generic Supabase query-builder stub ----
// Chains eq/is/order/limit/select/insert/update/delete (each returns `this`,
// recording the call) and resolves via .maybeSingle()/.single()/direct-await
// (implements `then`) to a scripted { data, error } result. Tests script the
// exact sequence of table calls a function makes; a table's queue is
// consumed in call order.

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
  is(...args: unknown[]) {
    return this.record("is", args);
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

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ASSEMBLY_ID = "22222222-2222-2222-2222-222222222222";

describe("parseProjectInput", () => {
  test("accepts a valid project, uppercasing the prefix", () => {
    expect(parseProjectInput({ name: "2026 Robot", partNumberPrefix: "ra2026" })).toEqual({
      name: "2026 Robot",
      partNumberPrefix: "RA2026",
    });
  });

  test.each([
    [{ name: "", partNumberPrefix: "RA2026" }], // empty name
    [{ name: "x".repeat(81), partNumberPrefix: "RA2026" }], // name too long
    [{ name: "Robot", partNumberPrefix: "" }], // empty prefix
    [{ name: "Robot", partNumberPrefix: "RA-2026" }], // hyphen not allowed
    [{ name: "Robot", partNumberPrefix: "x".repeat(21) }], // prefix too long
    [{ name: "Robot", partNumberPrefix: 123 }], // non-string prefix
    [{ name: "Robot" }], // missing prefix
    [null],
  ])("rejects %j", (body) => {
    expect(parseProjectInput(body)).toBeNull();
  });
});

describe("parsePartInput", () => {
  test("accepts a valid part with a parent assembly", () => {
    expect(
      parsePartInput({ projectId: PROJECT_ID, type: "part", name: "Bracket", parentPartId: ASSEMBLY_ID }),
    ).toEqual({
      projectId: PROJECT_ID,
      type: "part",
      name: "Bracket",
      parentPartId: ASSEMBLY_ID,
    });
  });

  test("accepts a valid top-level assembly (no parent)", () => {
    expect(parsePartInput({ projectId: PROJECT_ID, type: "assembly", name: "Frame" })).toEqual({
      projectId: PROJECT_ID,
      type: "assembly",
      name: "Frame",
      parentPartId: null,
    });
  });

  test("accepts a valid assembly with a parent", () => {
    expect(
      parsePartInput({ projectId: PROJECT_ID, type: "assembly", name: "Gearbox", parentPartId: ASSEMBLY_ID }),
    ).toEqual({
      projectId: PROJECT_ID,
      type: "assembly",
      name: "Gearbox",
      parentPartId: ASSEMBLY_ID,
    });
  });

  test.each([
    [{ projectId: "not-a-uuid", type: "part", name: "Bracket", parentPartId: ASSEMBLY_ID }],
    [{ projectId: PROJECT_ID, type: "widget", name: "Bracket" }], // invalid type
    [{ projectId: PROJECT_ID, type: "part", name: "", parentPartId: ASSEMBLY_ID }],
    [{ projectId: PROJECT_ID, type: "part", name: "x".repeat(121), parentPartId: ASSEMBLY_ID }],
    [{ projectId: PROJECT_ID, type: "part", name: "Bracket", parentPartId: "not-a-uuid" }],
    // A part with no parent is rejected — parts must belong to an assembly.
    [{ projectId: PROJECT_ID, type: "part", name: "Bracket" }],
    [{ projectId: PROJECT_ID, type: "part", name: "Bracket", parentPartId: null }],
    [null],
  ])("rejects %j", (body) => {
    expect(parsePartInput(body)).toBeNull();
  });
});

describe("parsePartPatch", () => {
  test("returns only provided fields", () => {
    expect(parsePartPatch({ status: "cnc" })).toEqual({ status: "cnc" });
    expect(parsePartPatch({ priority: 0, haveMaterial: true })).toEqual({ priority: 0, haveMaterial: true });
  });

  test("null on an empty body / no recognized field", () => {
    expect(parsePartPatch({})).toBeNull();
    expect(parsePartPatch({ unrelated: "x" })).toBeNull();
    expect(parsePartPatch(null)).toBeNull();
  });

  test("null when any provided field is invalid", () => {
    expect(parsePartPatch({ status: "not-a-status" })).toBeNull();
    expect(parsePartPatch({ priority: 3 })).toBeNull();
    expect(parsePartPatch({ name: "" })).toBeNull();
    expect(parsePartPatch({ haveMaterial: "yes" })).toBeNull();
    expect(parsePartPatch({ notes: "ok", priority: 9 })).toBeNull();
  });

  test("optional string fields trim and allow explicit null/clearing", () => {
    expect(parsePartPatch({ notes: " loose " })).toEqual({ notes: "loose" });
    expect(parsePartPatch({ notes: null })).toEqual({ notes: null });
  });
});

function partInput(overrides: Partial<Parameters<typeof createPart>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    type: "part" as const,
    name: "Bracket",
    parentPartId: ASSEMBLY_ID,
    ...overrides,
  };
}

describe("createPart — numbering", () => {
  test("first assembly in a project is numbered 0", async () => {
    const { db } = fakeDb({
      part: [
        { data: null, error: null }, // no existing assemblies
        { data: { id: "part-1" }, error: null }, // insert
      ],
    });
    const result = await createPart(partInput({ type: "assembly", name: "Frame", parentPartId: null }), db);
    expect(result).toEqual({ ok: true, id: "part-1", partNumber: 0 });
  });

  test("second assembly is numbered 1000", async () => {
    const { db } = fakeDb({
      part: [
        { data: { part_number: 0 }, error: null }, // existing assembly 0
        { data: { id: "part-2" }, error: null },
      ],
    });
    const result = await createPart(partInput({ type: "assembly", name: "Intake", parentPartId: null }), db);
    expect(result).toEqual({ ok: true, id: "part-2", partNumber: 1000 });
  });

  test("first part under an assembly seeds from the parent's own number (1000 -> 1001)", async () => {
    const { db } = fakeDb({
      part: [
        { data: { project_id: PROJECT_ID, type: "assembly" }, error: null }, // parent validation
        { data: null, error: null }, // no sibling parts under this assembly
        { data: { part_number: 1000, project_id: PROJECT_ID, type: "assembly" }, error: null }, // parent's own number
        { data: { id: "part-3" }, error: null }, // insert
      ],
    });
    const result = await createPart(partInput({ parentPartId: ASSEMBLY_ID }), db);
    expect(result).toEqual({ ok: true, id: "part-3", partNumber: 1001 });
  });

  test("sibling parts under the same assembly increment from the max sibling", async () => {
    const { db, stubs } = fakeDb({
      part: [
        { data: { project_id: PROJECT_ID, type: "assembly" }, error: null }, // parent validation
        { data: { part_number: 1001 }, error: null }, // existing sibling under this assembly
        { data: { id: "part-4" }, error: null }, // insert
      ],
    });
    const result = await createPart(partInput({ parentPartId: ASSEMBLY_ID }), db);
    expect(result).toEqual({ ok: true, id: "part-4", partNumber: 1002 });

    // A part's sibling query always filters on the parent id (parts are never
    // top-level), never .is("parent_part_id", null).
    const siblingQueryCalls = stubs.part[1].calls;
    expect(
      siblingQueryCalls.some((c) => c.method === "eq" && c.args[0] === "parent_part_id" && c.args[1] === ASSEMBLY_ID),
    ).toBe(true);
    expect(siblingQueryCalls.some((c) => c.method === "is")).toBe(false);
  });

  test("a 23505 collision recomputes and retries once, then succeeds", async () => {
    const { db } = fakeDb({
      part: [
        { data: null, error: null }, // assembly select, attempt 1 -> next 0
        { data: null, error: { code: "23505" } }, // insert attempt 1 fails (raced)
        { data: { part_number: 0 }, error: null }, // assembly select, attempt 2 -> next 1000
        { data: { id: "part-5" }, error: null }, // insert attempt 2 succeeds
      ],
    });
    const result = await createPart(partInput({ type: "assembly", name: "Retry", parentPartId: null }), db);
    expect(result).toEqual({ ok: true, id: "part-5", partNumber: 1000 });
  });

  test("a second consecutive 23505 gives up with 409", async () => {
    const { db } = fakeDb({
      part: [
        { data: null, error: null },
        { data: null, error: { code: "23505" } },
        { data: null, error: null },
        { data: null, error: { code: "23505" } },
      ],
    });
    const result = await createPart(partInput({ type: "assembly", name: "Retry", parentPartId: null }), db);
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("rejects a parent in a different project with 400", async () => {
    const { db } = fakeDb({
      part: [{ data: { project_id: "other-project", type: "assembly" }, error: null }],
    });
    const result = await createPart(partInput({ parentPartId: ASSEMBLY_ID }), db);
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("rejects a parent that is not an assembly with 400", async () => {
    const { db } = fakeDb({
      part: [{ data: { project_id: PROJECT_ID, type: "part" }, error: null }],
    });
    const result = await createPart(partInput({ parentPartId: ASSEMBLY_ID }), db);
    expect(result).toEqual({ ok: false, status: 400 });
  });

  test("rejects a nonexistent parent with 400", async () => {
    const { db } = fakeDb({
      part: [{ data: null, error: null }],
    });
    const result = await createPart(partInput({ parentPartId: ASSEMBLY_ID }), db);
    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe("deletePart", () => {
  test("404 when the part is missing", async () => {
    const { db } = fakeDb({ part: [{ data: null, error: null }] });
    expect(await deletePart("part-1", db)).toEqual({ ok: false, status: 404 });
  });

  test("409 when the part (an assembly) has children", async () => {
    const { db } = fakeDb({
      part: [
        { data: { id: "part-1" }, error: null }, // exists
        { data: [{ id: "child-1" }], error: null }, // has children
      ],
    });
    expect(await deletePart("part-1", db)).toEqual({ ok: false, status: 409 });
  });

  test("ok when the part has no children", async () => {
    const { db } = fakeDb({
      part: [
        { data: { id: "part-1" }, error: null },
        { data: [], error: null },
        { data: null, error: null }, // delete
      ],
    });
    expect(await deletePart("part-1", db)).toEqual({ ok: true, status: 200 });
  });
});

describe("countPartsByProject", () => {
  test("tallies part rows by project_id in one query", async () => {
    const { db } = fakeDb({
      part: [
        {
          data: [
            { project_id: "proj-a" },
            { project_id: "proj-a" },
            { project_id: "proj-b" },
          ],
          error: null,
        },
      ],
    });
    expect(await countPartsByProject(db)).toEqual({ "proj-a": 2, "proj-b": 1 });
  });

  test("empty table yields an empty record", async () => {
    const { db } = fakeDb({ part: [{ data: [], error: null }] });
    expect(await countPartsByProject(db)).toEqual({});
  });
});

describe("deleteProject", () => {
  test("404 when the project is missing", async () => {
    const { db } = fakeDb({ project: [{ data: null, error: null }] });
    expect(await deleteProject("proj-1", db)).toEqual({ ok: false, status: 404 });
  });

  test("409 when the project has parts", async () => {
    const { db } = fakeDb({
      project: [{ data: { id: "proj-1" }, error: null }],
      part: [{ data: [{ id: "part-1" }], error: null }],
    });
    expect(await deleteProject("proj-1", db)).toEqual({ ok: false, status: 409 });
  });

  test("ok when the project has no parts", async () => {
    const { db } = fakeDb({
      project: [{ data: { id: "proj-1" }, error: null }, { data: null, error: null }],
      part: [{ data: [], error: null }],
    });
    expect(await deleteProject("proj-1", db)).toEqual({ ok: true, status: 200 });
  });
});

function mkPart(overrides: Partial<Part>): Part {
  return {
    id: "id",
    projectId: PROJECT_ID,
    parentPartId: null,
    partNumber: 0,
    type: "part",
    name: "Part",
    status: "designing",
    priority: 1,
    notes: null,
    sourceMaterial: null,
    haveMaterial: false,
    quantity: null,
    cutLength: null,
    drawingCreated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    onshapeDocumentId: null,
    onshapeElementId: null,
    onshapePartId: null,
    onshapeUrl: null,
    ...overrides,
  };
}

describe("partAncestors", () => {
  test("a top-level part has no ancestors", () => {
    const part = mkPart({ id: "p1", parentPartId: null });
    expect(partAncestors(part, [part])).toEqual([]);
  });

  test("returns the multi-level chain from top ancestor down to the immediate parent", () => {
    const grandparent = mkPart({ id: "gp", name: "Drivetrain", type: "assembly", parentPartId: null });
    const parent = mkPart({ id: "p", name: "Gearbox", type: "assembly", parentPartId: "gp" });
    const child = mkPart({ id: "c", name: "Shaft", parentPartId: "p" });
    const all = [grandparent, parent, child];
    expect(partAncestors(child, all)).toEqual([grandparent, parent]);
  });
});

describe("sortParts", () => {
  const a = mkPart({ id: "a", name: "Zeta", partNumber: 2, type: "part", status: "done", parentPartId: null });
  const b = mkPart({ id: "b", name: "Alpha", partNumber: 1, type: "assembly", status: "designing", parentPartId: "a" });

  test("sorts by number ascending", () => {
    expect(sortParts([a, b], "number").map((p) => p.id)).toEqual(["b", "a"]);
  });

  test("sorts by type ascending", () => {
    expect(sortParts([a, b], "type").map((p) => p.id)).toEqual(["b", "a"]); // "assembly" < "part"
  });

  test("sorts by name ascending", () => {
    expect(sortParts([a, b], "name").map((p) => p.id)).toEqual(["b", "a"]); // "Alpha" < "Zeta"
  });

  test("sorts by parent name ascending (top-level sorts first)", () => {
    expect(sortParts([a, b], "parent").map((p) => p.id)).toEqual(["a", "b"]); // "" < "Zeta"
  });

  test("sorts by status pipeline order ascending", () => {
    expect(sortParts([a, b], "status").map((p) => p.id)).toEqual(["b", "a"]); // designing before done
  });
});

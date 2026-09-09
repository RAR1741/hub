import { describe, expect, test, vi } from "vitest";
import {
  createBattery,
  createUsage,
  parseBatteryInput,
  parseUsageInput,
  sortByLastUsed,
} from "./batteries";

// ---- Generic Supabase query-builder stub (copied from parts.test.ts) ----
// Chains eq/order/limit/select/insert/update/delete (each returns `this`,
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

const BATTERY_ID = "11111111-1111-1111-1111-111111111111";
const TECH_ID = "22222222-2222-2222-2222-222222222222";

const validBattery = {
  number: "2026-01",
  yearAcquired: 2026,
  model: "NP18-12B",
  serialDateCode: "YQ24F",
  manufacturer: "Enersys",
  tradeName: "Genesis",
  ampHourRating: 17.2,
  notes: "shop shelf 2",
  status: "active",
};

describe("parseBatteryInput", () => {
  test("accepts a valid active battery", () => {
    expect(parseBatteryInput(validBattery)).toEqual({
      number: "2026-01",
      yearAcquired: 2026,
      model: "NP18-12B",
      serialDateCode: "YQ24F",
      manufacturer: "Enersys",
      tradeName: "Genesis",
      ampHourRating: 17.2,
      notes: "shop shelf 2",
      status: "active",
      retiredAt: null,
      retiredReason: null,
      kind: "frc_robot",
    });
  });

  test("defaults kind to frc_robot when absent", () => {
    expect(parseBatteryInput(validBattery)?.kind).toBe("frc_robot");
  });

  test("accepts a valid non-default kind", () => {
    expect(parseBatteryInput({ ...validBattery, kind: "tool" })?.kind).toBe("tool");
  });

  test("rejects an invalid kind", () => {
    expect(parseBatteryInput({ ...validBattery, kind: "drone" })).toBeNull();
  });

  test("rejects an empty number", () => {
    expect(parseBatteryInput({ ...validBattery, number: "" })).toBeNull();
  });

  test("retired without retiredAt defaults to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));
    try {
      expect(parseBatteryInput({ ...validBattery, status: "retired", retiredReason: "cracked case" })).toEqual(
        expect.objectContaining({ status: "retired", retiredAt: "2026-09-03T12:00:00.000Z", retiredReason: "cracked case" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("active clears retired fields even if submitted", () => {
    expect(
      parseBatteryInput({
        ...validBattery,
        status: "active",
        retiredAt: "2026-01-01T00:00:00.000Z",
        retiredReason: "should be dropped",
      }),
    ).toEqual(expect.objectContaining({ status: "active", retiredAt: null, retiredReason: null }));
  });

  test("rejects a bad year", () => {
    expect(parseBatteryInput({ ...validBattery, yearAcquired: 1900 })).toBeNull();
  });

  test("rejects a non-finite amp-hour rating", () => {
    expect(parseBatteryInput({ ...validBattery, ampHourRating: 0 })).toBeNull();
    expect(parseBatteryInput({ ...validBattery, ampHourRating: 1001 })).toBeNull();
  });

  test("rejects an invalid status", () => {
    expect(parseBatteryInput({ ...validBattery, status: "dead" })).toBeNull();
  });

  test("rejects a non-object body", () => {
    expect(parseBatteryInput(null)).toBeNull();
  });
});

const validUsage = {
  batteryId: BATTERY_ID,
  usedAt: "2026-09-01T10:00:00.000Z",
  eventKey: "2026incol",
  matchKey: "qm1",
  hadProblem: false,
  chargePrePct: 100,
  chargePostPct: 80,
};

describe("parseUsageInput", () => {
  test("accepts a valid usage entry", () => {
    expect(parseUsageInput(validUsage)).toEqual({
      batteryId: BATTERY_ID,
      usedAt: "2026-09-01T10:00:00.000Z",
      eventKey: "2026incol",
      matchKey: "qm1",
      hadProblem: false,
      problemDescription: null,
      wiggleTestOk: null,
      chargerTestOk: null,
      rintOhms: null,
      chargePrePct: 100,
      chargePostPct: 80,
      notes: null,
    });
  });

  test("lowercases and validates eventKey shape", () => {
    expect(parseUsageInput({ ...validUsage, eventKey: "2026INCOL" })?.eventKey).toBe("2026incol");
  });

  test("rejects an eventKey with no leading 4-digit year", () => {
    expect(parseUsageInput({ ...validUsage, eventKey: "incol" })).toBeNull();
  });

  test("keeps matchKey verbatim aside from trimming", () => {
    expect(parseUsageInput({ ...validUsage, matchKey: "Prac 4" })?.matchKey).toBe("Prac 4");
  });

  test("accepts chargePostPct above 100 (may exceed full charge)", () => {
    expect(parseUsageInput({ ...validUsage, chargePostPct: 130 })?.chargePostPct).toBe(130);
  });

  test("drops problemDescription when hadProblem is false", () => {
    const result = parseUsageInput({ ...validUsage, hadProblem: false, problemDescription: "won't hold charge" });
    expect(result?.problemDescription).toBeNull();
  });

  test("keeps problemDescription when hadProblem is true", () => {
    const result = parseUsageInput({ ...validUsage, hadProblem: true, problemDescription: "won't hold charge" });
    expect(result?.problemDescription).toBe("won't hold charge");
  });

  test("rejects a non-uuid batteryId", () => {
    expect(parseUsageInput({ ...validUsage, batteryId: "not-a-uuid" })).toBeNull();
  });

  test("rejects a non-object body", () => {
    expect(parseUsageInput(null)).toBeNull();
  });
});

describe("createBattery", () => {
  test("maps a unique-violation to 409", async () => {
    const { db } = fakeDb({
      battery: [{ data: null, error: { code: "23505" } }],
    });
    const input = parseBatteryInput(validBattery)!;
    expect(await createBattery(input, db)).toEqual({ ok: false, status: 409 });
  });

  test("returns the new id on success", async () => {
    const { db } = fakeDb({
      battery: [{ data: { id: "battery-1" }, error: null }],
    });
    const input = parseBatteryInput(validBattery)!;
    expect(await createBattery(input, db)).toEqual({ ok: true, id: "battery-1" });
  });

  test("insert payload includes kind", async () => {
    const { db, stubs } = fakeDb({
      battery: [{ data: { id: "battery-1" }, error: null }],
    });
    const input = parseBatteryInput({ ...validBattery, kind: "tool" })!;
    await createBattery(input, db);
    expect(stubs.battery[0].calls[0]).toEqual({ method: "insert", args: [expect.objectContaining({ kind: "tool" })] });
  });
});

describe("createUsage", () => {
  test("maps a foreign-key violation (unknown battery) to 400", async () => {
    const { db } = fakeDb({
      battery: [{ data: null, error: null }],
      battery_usage: [{ data: null, error: { code: "23503" } }],
    });
    const input = parseUsageInput(validUsage)!;
    expect(await createUsage(input, TECH_ID, db)).toEqual({ ok: false, status: 400 });
  });

  test("returns the new id on success", async () => {
    const { db } = fakeDb({
      battery: [{ data: { id: BATTERY_ID, kind: "frc_robot" }, error: null }],
      battery_usage: [{ data: { id: "usage-1" }, error: null }],
    });
    const input = parseUsageInput(validUsage)!;
    expect(await createUsage(input, TECH_ID, db)).toEqual({ ok: true, id: "usage-1" });
  });

  test("nulls the seven FRC-only fields for a non-FRC battery", async () => {
    const { db, stubs } = fakeDb({
      battery: [{ data: { id: BATTERY_ID, kind: "tool" }, error: null }],
      battery_usage: [{ data: { id: "usage-1" }, error: null }],
    });
    const input = parseUsageInput({
      ...validUsage,
      hadProblem: true,
      problemDescription: "won't hold charge",
      wiggleTestOk: true,
      chargerTestOk: true,
      rintOhms: 0.02,
      notes: "fine",
    })!;
    await createUsage(input, TECH_ID, db);
    const insertPayload = stubs.battery_usage[0].calls[0].args[0] as Record<string, unknown>;
    expect(insertPayload).toMatchObject({
      event_key: null,
      match_key: null,
      wiggle_test_ok: null,
      charger_test_ok: null,
      rint_ohms: null,
      charge_pre_pct: null,
      charge_post_pct: null,
      had_problem: true,
      notes: "fine",
    });
  });

  test("passes the seven FRC-only fields through unchanged for an frc_robot battery", async () => {
    const { db, stubs } = fakeDb({
      battery: [{ data: { id: BATTERY_ID, kind: "frc_robot" }, error: null }],
      battery_usage: [{ data: { id: "usage-1" }, error: null }],
    });
    const input = parseUsageInput({
      ...validUsage,
      wiggleTestOk: true,
      chargerTestOk: false,
      rintOhms: 0.02,
    })!;
    await createUsage(input, TECH_ID, db);
    const insertPayload = stubs.battery_usage[0].calls[0].args[0] as Record<string, unknown>;
    expect(insertPayload).toMatchObject({
      event_key: "2026incol",
      match_key: "qm1",
      wiggle_test_ok: true,
      charger_test_ok: false,
      rint_ohms: 0.02,
      charge_pre_pct: 100,
      charge_post_pct: 80,
    });
  });
});

describe("sortByLastUsed", () => {
  function row(id: string, lastUsedAt: string | null, status: "active" | "retired" = "active") {
    return { id, status, lastUsedAt } as { id: string; status: "active" | "retired"; lastUsedAt: string | null };
  }

  test("never-used first, then oldest-used first, retired always last", () => {
    const neverUsed = row("never", null);
    const oldest = row("oldest", "2026-01-01T00:00:00.000Z");
    const newest = row("newest", "2026-06-01T00:00:00.000Z");
    const retiredButNeverUsed = row("retired-never", null, "retired");
    const retiredRecentlyUsed = row("retired-used", "2026-01-01T00:00:00.000Z", "retired");

    const sorted = sortByLastUsed([newest, retiredRecentlyUsed, oldest, retiredButNeverUsed, neverUsed]);
    expect(sorted.map((r) => r.id)).toEqual(["never", "oldest", "newest", "retired-never", "retired-used"]);
  });
});

import { describe, expect, test } from "vitest";
import { deletePeriod, parsePeriodInput } from "./periods";

describe("parsePeriodInput", () => {
  test("accepts a valid period", () => {
    expect(
      parsePeriodInput({ name: " Fall ", startsOn: "2026-08-01", endsOn: "2026-12-31" }),
    ).toEqual({ name: "Fall", startsOn: "2026-08-01", endsOn: "2026-12-31" });
  });
  test.each([
    [{ name: "", startsOn: "2026-08-01", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "not-a-date", endsOn: "2026-12-31" }],
    [{ name: "X", startsOn: "2026-08-01", endsOn: "2026-07-01" }], // end before start
    [{ name: "X", startsOn: "2026-08-01" }],                        // missing end
    [null],
  ])("rejects %j", (body) => {
    expect(parsePeriodInput(body)).toBeNull();
  });
  test("rejects a name longer than 80 chars", () => {
    expect(
      parsePeriodInput({ name: "x".repeat(81), startsOn: "2026-08-01", endsOn: "2026-12-31" }),
    ).toBeNull();
  });
});

describe("deletePeriod", () => {
  function fakeDb(opts: { periodExists: boolean; sessionCount: number }) {
    return {
      from(table: string) {
        if (table === "period") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.periodExists ? { id: "pd1" } : null,
                  error: null,
                }),
              }),
            }),
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
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

  test("404 when the period is missing", async () => {
    const result = await deletePeriod("pd1", fakeDb({ periodExists: false, sessionCount: 0 }));
    expect(result).toEqual({ ok: false, status: 404 });
  });

  test("409 when the period has sessions (don't silently delete history)", async () => {
    const result = await deletePeriod("pd1", fakeDb({ periodExists: true, sessionCount: 1 }));
    expect(result).toEqual({ ok: false, status: 409 });
  });

  test("ok when the period has no sessions", async () => {
    const result = await deletePeriod("pd1", fakeDb({ periodExists: true, sessionCount: 0 }));
    expect(result).toEqual({ ok: true, status: 200 });
  });
});

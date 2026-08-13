import { describe, expect, test } from "vitest";
import { clockIn } from "./sessions";

// Minimal fake db capturing the insert; getActivePeriod resolves to a period.
function fakeDb(opts: { activePeriod: { id: string } | null; insertError?: { code: string } }) {
  return {
    from(table: string) {
      if (table === "period") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.activePeriod, error: null }) }),
          }),
        };
      }
      // session
      return {
        insert: async () => ({ error: opts.insertError ?? null }),
      };
    },
  } as never;
}

describe("clockIn", () => {
  test("409 no_active_period when no active period", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: null }));
    expect(r).toEqual({ ok: false, status: 409, reason: "no_active_period" });
  });
  test("409 already_in on unique violation (23505)", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: { id: "pd1" }, insertError: { code: "23505" } }));
    expect(r).toEqual({ ok: false, status: 409, reason: "already_in" });
  });
  test("400 invalid_person on foreign-key violation (23503)", async () => {
    const r = await clockIn("nope", fakeDb({ activePeriod: { id: "pd1" }, insertError: { code: "23503" } }));
    expect(r).toEqual({ ok: false, status: 400, reason: "invalid_person" });
  });
  test("ok when insert succeeds", async () => {
    const r = await clockIn("p1", fakeDb({ activePeriod: { id: "pd1" } }));
    expect(r).toEqual({ ok: true });
  });
});

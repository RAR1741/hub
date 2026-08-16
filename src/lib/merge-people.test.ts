import { describe, expect, test } from "vitest";
import { mergePeople } from "./merge-people";

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

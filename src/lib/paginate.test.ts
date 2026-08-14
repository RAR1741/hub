import { expect, test } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { fetchAllRows, PAGE_SIZE } from "./paginate";

// Fake store that returns rows in [from, to], with a server-side page cap.
function pager(total: number, cap = PAGE_SIZE) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  let calls = 0;
  const page = async (from: number, to: number) => {
    calls++;
    const end = Math.min(to + 1, from + cap); // simulate db-max-rows cap on page size
    return { data: all.slice(from, end), error: null };
  };
  return { page, calls: () => calls };
}

test("fetches every row across pages (past the 1000 cap)", async () => {
  const { rows, error } = await fetchAllRows(pager(1347).page);
  expect(error).toBeNull();
  expect(rows).toHaveLength(1347);
  expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 1347 }, (_, i) => i));
});

test("stays correct when the server cap is below PAGE_SIZE", async () => {
  const { rows } = await fetchAllRows(pager(1200, 500).page);
  expect(rows).toHaveLength(1200);
});

test("an exact multiple of PAGE_SIZE terminates via one empty read", async () => {
  const p = pager(2000);
  const { rows } = await fetchAllRows(p.page);
  expect(rows).toHaveLength(2000);
  expect(p.calls()).toBe(3); // 1000, 1000, then empty
});

test("propagates an error and returns rows gathered so far", async () => {
  let n = 0;
  const { rows, error } = await fetchAllRows<{ id: number }>(async () => {
    n += 1;
    if (n === 1) return { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null };
    const err = { message: "boom", details: "", hint: "", code: "" } as unknown as PostgrestError;
    return { data: null, error: err };
  });
  expect(error?.message).toBe("boom");
  expect(rows).toHaveLength(PAGE_SIZE);
});

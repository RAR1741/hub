import type { PostgrestError } from "@supabase/supabase-js";

// PostgREST caps a single response at `db-max-rows` (1000 by default). A
// period-wide read that exceeds this silently truncates — the classic
// "everyone past row 1000 vanishes" bug. Page through with .range() instead.
export const PAGE_SIZE = 1000;

/**
 * Fetch every row of a query that would otherwise hit the max-rows cap.
 *
 * `page(from, to)` must run the query with `.range(from, to)` AND a STABLE
 * total order (a unique tiebreaker such as `id`) so pages neither skip nor
 * repeat rows. The loop advances by how many rows actually came back and stops
 * only on an empty page — so it stays correct even if a server's cap is set
 * below PAGE_SIZE. PURE aside from the injected query.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ rows: T[]; error: PostgrestError | null }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const batch = data ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
    from += batch.length;
  }
  return { rows, error: null };
}

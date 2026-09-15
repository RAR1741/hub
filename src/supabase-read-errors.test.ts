import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Supabase read-error guardrail (#287).
 *
 * `AGENTS.md` requires checking `error` on every `.select()`. A read that
 * destructures only `data` swallows the failure: `data` comes back null, the
 * usual `?? []` turns it into a normal-looking empty list, and an existence
 * probe turns it into a confident 404 for a row that exists. Nothing logs,
 * nothing 500s, and debugging starts from "the page is blank".
 *
 * This test fails on any `const { ... } = await ...` that destructures `data`
 * without also destructuring `error`. What you do with the error is a judgment
 * call (log and fall back to empty for a list, 500 instead of 404 for a probe);
 * naming it is not.
 *
 * Nested destructures (`const { data: { user } } = await supabase.auth...`) are
 * skipped — those are auth-client calls, not table reads.
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)));
const DESTRUCTURE = /const\s*\{([^{}]*)\}\s*=\s*await\b/g;
// `data` / `data: rows` bound at key position — not `{ rows: data }`, where
// `data` is only the local name for someone else's already-checked result.
const BINDS_DATA = /(^|,)\s*data\s*(:|,|$)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** Line numbers in `text` where a read destructures `data` without `error`. */
function uncheckedReads(text: string): number[] {
  const lines: number[] = [];
  for (const match of text.matchAll(DESTRUCTURE)) {
    const bindings = match[1];
    if (!BINDS_DATA.test(bindings) || /\berror\b/.test(bindings)) continue;
    lines.push(text.slice(0, match.index).split("\n").length);
  }
  return lines;
}

describe("supabase reads check error", () => {
  test("the scan catches an unchecked read and passes a checked one", () => {
    expect(uncheckedReads("const { data } = await db.from('x').select('*');")).toEqual([1]);
    expect(uncheckedReads("const { data: rows } = await db.from('x').select('*');")).toEqual([1]);
    expect(uncheckedReads("const { data, error } = await db.from('x').select('*');")).toEqual([]);
    // `data` as the local alias of an already-checked result is not a read.
    expect(uncheckedReads("const { rows: data } = await fetchAllRows(cb);")).toEqual([]);
  });

  test("no `const { data }` destructure omits `error`", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      const rel = path.relative(SRC, file).replaceAll("\\", "/");
      offenders.push(...uncheckedReads(text).map((line) => `${rel}:${line}`));
    }
    expect(offenders).toEqual([]);
    // Reads every source file — well past the 5s default on a loaded machine.
  }, 30_000);
});

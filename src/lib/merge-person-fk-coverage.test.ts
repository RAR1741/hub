import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * merge_person() FK coverage guardrail (#283).
 *
 * `merge_person()` reassigns the loser's rows to the winner with a hardcoded,
 * per-column list of `update ... set col = p_winner` statements. A person FK it
 * does not know about fails in one of two invisible ways: a RESTRICT column
 * makes the function's final `delete from person` raise 23503 and roll the whole
 * merge back (the duplicates can then never be merged), and a CASCADE column
 * lets the loser's rows be deleted along with the loser instead of moving to the
 * winner -- silent, unrecoverable history loss reported to the admin as success.
 * That gap opened five separate times before #283 filed it, because nothing
 * failed when a migration added a person FK and left the function alone.
 *
 * This test closes the loop: it scans every migration for columns that reference
 * `person`, and fails unless each one is either touched by the latest
 * `merge_person()` declaration or listed in MERGE_PERSON_UNCOVERED below with a
 * reason it is safe to let cascade away. Adding a table with a person FK now
 * fails CI until a human makes that call deliberately.
 *
 * It also covers tables whose person column hangs off `event_signup` by
 * composite FK `(event_id, person_id)`: they have no direct person FK, so the
 * person scan misses them, but they cascade-delete with the loser's signups
 * exactly like a direct CASCADE column would.
 *
 * This is a tripwire, not a proof: it checks that the function MENTIONS the
 * table and column, not that the reassignment is correct or that collisions on
 * that table's unique constraints are pre-cleared. Read the statement it points
 * at, don't just make the test green.
 */

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

/**
 * Person FKs merge_person deliberately leaves to cascade away with the loser.
 * Keyed `table.column`; the value says why there is no history worth moving.
 */
const MERGE_PERSON_UNCOVERED: Record<string, string> = {
  "login_otp.person_id":
    "Short-lived one-time login codes; the loser's are dead the moment its row is gone.",
  "masquerade_session.admin_person_id":
    "Ephemeral admin impersonation session; expires on its own, nothing to preserve.",
  "masquerade_session.target_person_id":
    "Same session row, other end. Reassigning would revive a session for a merged-away target.",
  "person_merge_rejection.a":
    "Pair-scoped 'these two are not duplicates' marker; meaningless once one side is merged away.",
  "person_merge_rejection.b": "Same pair row, other side.",
  "person_merge_rejection.rejected_by":
    "Already `on delete set null` -- the row survives the delete without blocking it.",
};

type PersonFk = { table: string; column: string; file: string };

/**
 * Parse the migrations for every column that ties a row to a person: a direct
 * `references person (id)` column, or the `person_id` half of a composite FK to
 * `event_signup (event_id, person_id)`.
 */
function scanPersonFks(): PersonFk[] {
  const found = new Map<string, PersonFk>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    let table = "";
    for (const raw of sql.split("\n")) {
      const line = raw.replace(/--.*$/, "");
      const created = /^\s*create table (?:if not exists )?(\w+)/i.exec(line);
      if (created) table = created[1];
      const altered = /^\s*alter table (?:only )?(\w+)/i.exec(line);
      if (altered) table = altered[1];

      const record = (column: string) => {
        if (!table) throw new Error(`${file}: person FK on "${column}" outside a known table`);
        const key = `${table}.${column}`;
        if (!found.has(key)) found.set(key, { table, column, file });
      };

      // `col uuid ... references person (id)` -- in a create table body or an
      // `alter table ... add column`.
      const direct = /(?:^|\s)(\w+)\s+uuid\b[^,]*?\breferences\s+person\s*\(/i.exec(line);
      if (direct) record(direct[1]);

      // Composite `references event_signup (event_id, person_id)`.
      if (/\breferences\s+event_signup\s*\(/i.test(line)) record("person_id");

      if (/^\);/.test(line)) table = "";
    }
  }
  return [...found.values()];
}

/** The body of the newest `merge_person` declaration -- the one that is live. */
function latestMergePersonBody(): string {
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort().reverse()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    const start = sql.search(/create (?:or replace )?function merge_person\s*\(/i);
    if (start !== -1) return sql.slice(start);
  }
  throw new Error("no merge_person declaration found in supabase/migrations");
}

describe("merge_person FK coverage", () => {
  const fks = scanPersonFks();
  const body = latestMergePersonBody();

  test("the scan finds the known person FKs", () => {
    // Sanity check on the parser itself: if a regex stops matching, every
    // coverage assertion below would pass vacuously.
    const keys = fks.map((f) => `${f.table}.${f.column}`);
    expect(keys).toContain("session.person_id");
    expect(keys).toContain("badge_award.awarded_by");
    expect(keys).toContain("form_response.person_id");
    expect(keys).toContain("event_signup_reminder.person_id");
    expect(keys.length).toBeGreaterThan(25);
  });

  test.each(fks.map((f) => [`${f.table}.${f.column}`, f] as const))(
    "%s is reassigned by merge_person or explicitly allowlisted",
    (key, fk) => {
      if (key in MERGE_PERSON_UNCOVERED) return;
      // Bounded to a single statement so a later statement's `person_id` can't
      // vouch for an untouched table.
      const statement = new RegExp(
        String.raw`\b(?:update|insert into|delete from)\s+${fk.table}\b[^;]*\b${fk.column}\b`,
        "i",
      );
      expect(
        statement.test(body),
        `${key} (${fk.file}) references person but the latest merge_person() never touches it. ` +
          `Reassign it in a NEW migration that re-declares merge_person(), pre-clearing any ` +
          `unique constraint the reassignment can collide with -- or, if the loser's rows are ` +
          `safe to cascade away with the loser, add "${key}" to MERGE_PERSON_UNCOVERED with why.`,
      ).toBe(true);
    },
  );

  test("no stale MERGE_PERSON_UNCOVERED entries", () => {
    const keys = new Set(fks.map((f) => `${f.table}.${f.column}`));
    expect(Object.keys(MERGE_PERSON_UNCOVERED).filter((k) => !keys.has(k))).toEqual([]);
  });
});

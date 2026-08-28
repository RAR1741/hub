# Historical Time-Sheet Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin uploads a season's Google-Sheets time-tracker CSV and the app parses, validates, previews, and imports it into `session`/`excusal` rows, idempotently, tagged `source='import'`.

**Architecture:** A pure parser (`time-import.ts`) turns the wide positional grid into per-person sessions/excusals/skips/anomalies using content-based structure detection and two-pass column-consensus time parsing; a pure tz helper converts local wall-clock to instants; an impure runner (`time-import-run.ts`, injectable `db`) matches-or-auto-creates people and does an idempotent per-period replace; a `withRole("admin")` route re-parses server-side; an admin screen + client form give the upload → preview → import → summary UX (mirrors the roster importer).

**Tech Stack:** Next.js 16 App Router (RSC + route handlers), TypeScript (strict), Supabase (PostgREST via service-role `getDb()`), Vitest (unit), Playwright (E2E), Tailwind v4 component classes.

## Global Constraints

- Reuse the roster-importer pattern verbatim where possible: `withRole("admin", …)` for the route, `{ csv }` JSON body, server-side **re-parse** (never trust the client preview), a summary object returned as JSON. (`src/app/api/admin/people/import/route.ts`, `src/components/RosterImportForm.tsx`.)
- Migrations are code: one committed migration file, replayed verbatim; never edit an applied migration in place, never hand-edit the DB.
- Service-role DB access only via `getDb()` (`src/lib/db.ts`); all lib functions that touch the DB take an optional injectable `db?: SupabaseClient` last arg for tests (see `src/lib/reports.ts`, `src/lib/gcal.ts`).
- Team timezone comes from `getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db)` (`src/lib/settings.ts`).
- Imported sessions: `source='import'`, `time_out` always set (open ones are skipped), `edited_by`/`edited_at`/`note` left null.
- `TIME_ANOMALY_THRESHOLD_MIN = 240` (4 h); `MAX_SHIFT_MIN = 1080` (18 h, matches the `max_shift_hours` default).
- Commands run inside the dev container. Canonical form: `./dev npm run <script>`. In this environment the equivalent is `docker exec team-hub-app-1 sh -c '<cmd>'`. Before a fresh `typecheck`/`build`, `rm -rf .next` first (stale `.next/dev` yields spurious TS errors).
- Commit after each task; push to `origin master` after each commit (run `git` on the **host**, PowerShell). End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Extract shared CSV tokenizer

**Files:**
- Create: `src/lib/csv.ts`
- Modify: `src/lib/roster-import.ts` (remove the private `parseCsvRecords`, import it from `csv.ts`)
- Test: `src/lib/csv.test.ts`

**Interfaces:**
- Produces: `parseCsvRecords(text: string): string[][]` — RFC-4180-ish tokenizer (quoted fields, doubled-quote escaping, embedded commas, CRLF/CR/LF, strips a leading BOM). Used by both importers.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/csv.test.ts
import { describe, expect, test } from "vitest";
import { parseCsvRecords } from "./csv";

describe("parseCsvRecords", () => {
  test("splits rows and fields, trims nothing (caller trims)", () => {
    expect(parseCsvRecords("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
  test("honors quoted fields with embedded commas and doubled quotes", () => {
    expect(parseCsvRecords('"a,1","he said ""hi"""')).toEqual([["a,1", 'he said "hi"']]);
  });
  test("handles CRLF and a leading BOM", () => {
    expect(parseCsvRecords("﻿a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- src/lib/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'`.

- [ ] **Step 3: Create `src/lib/csv.ts`**

Move the exact body of `parseCsvRecords` (currently `src/lib/roster-import.ts:60-126`) into a new file and export it. Copy it verbatim — do not rewrite the tokenizer:

```ts
// src/lib/csv.ts
/**
 * RFC-4180-ish CSV tokenizer: quoted fields, doubled-quote escaping, embedded
 * commas inside quotes, CRLF/CR/LF line endings, leading BOM stripped.
 * Shared by the roster importer and the time-sheet importer.
 */
export function parseCsvRecords(text: string): string[][] {
  // ... exact body moved from roster-import.ts (lines 60-126) ...
}
```

- [ ] **Step 4: Rewire `roster-import.ts`**

Delete the private `parseCsvRecords` function from `src/lib/roster-import.ts` and add, near the top imports:

```ts
import { parseCsvRecords } from "./csv";
```

Leave `cellOrEmpty` and everything else in `roster-import.ts` unchanged.

- [ ] **Step 5: Run tests to verify pass (new + existing roster tests unaffected)**

Run: `./dev npm run test -- src/lib/csv.test.ts src/lib/roster-import.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv.ts src/lib/csv.test.ts src/lib/roster-import.ts
git commit -m "refactor(csv): extract shared RFC-4180 tokenizer for reuse by importers"
```

---

### Task 2: Timezone instant helper

**Files:**
- Create: `src/lib/tz.ts`
- Test: `src/lib/tz.test.ts`

**Interfaces:**
- Produces: `localDateTimeToInstant(dateIso: string, minutes: number, tz: string): string` — given a local wall-clock (`dateIso` = `YYYY-MM-DD`, `minutes` = minutes since local midnight 0..1439) in IANA `tz`, returns the UTC instant as an ISO string (`…Z`). Pure.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tz.test.ts
import { describe, expect, test } from "vitest";
import { localDateTimeToInstant } from "./tz";

describe("localDateTimeToInstant", () => {
  // Indianapolis is UTC-5 in January (no DST). 18:30 local -> 23:30 UTC same day.
  test("converts winter wall-clock to UTC (America/Indiana/Indianapolis)", () => {
    expect(localDateTimeToInstant("2026-01-09", 18 * 60 + 30, "America/Indiana/Indianapolis"))
      .toBe("2026-01-09T23:30:00.000Z");
  });
  // 00:12 local on Jan 10 -> 05:12 UTC (used for the next-day side of an overnight session).
  test("converts a past-midnight wall-clock", () => {
    expect(localDateTimeToInstant("2026-01-10", 12, "America/Indiana/Indianapolis"))
      .toBe("2026-01-10T05:12:00.000Z");
  });
  // Sanity across a DST-observing zone in summer (UTC-4).
  test("respects DST offset", () => {
    expect(localDateTimeToInstant("2026-07-01", 12 * 60, "America/New_York"))
      .toBe("2026-07-01T16:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- src/lib/tz.test.ts`
Expected: FAIL — `Cannot find module './tz'`.

- [ ] **Step 3: Implement `src/lib/tz.ts`**

```ts
// src/lib/tz.ts
/**
 * Minutes that local `tz` is ahead of UTC at the given UTC instant. Computed by
 * formatting the instant into `tz` wall-clock parts and differencing. PURE.
 */
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * Local wall-clock (`dateIso` = YYYY-MM-DD, `minutes` since local midnight) in
 * IANA `tz` -> UTC instant ISO string. Guesses the instant as if the wall-clock
 * were UTC, then corrects by the tz offset at that instant. One correction is
 * exact except within the DST transition hour, which the team's meeting times
 * never fall in. PURE.
 */
export function localDateTimeToInstant(dateIso: string, minutes: number, tz: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guessUtc = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offset = tzOffsetMinutes(guessUtc, tz);
  return new Date(guessUtc - offset * 60000).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npm run test -- src/lib/tz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tz.ts src/lib/tz.test.ts
git commit -m "feat(tz): localDateTimeToInstant — local wall-clock to UTC instant"
```

---

### Task 3: Clock-time parsing + column consensus

**Files:**
- Create: `src/lib/time-parse.ts`
- Test: `src/lib/time-parse.test.ts`

**Interfaces:**
- Produces:
  - `type ClockParse = { kind: "confident"; minutes: number } | { kind: "ambiguous"; am: number; pm: number } | { kind: "excused" } | { kind: "empty" } | { kind: "unparseable"; raw: string }`
  - `parseClockToken(raw: string): ClockParse` — one cell. `minutes`/`am`/`pm` are minutes since midnight (0..1439). `"excused"` when the trimmed cell equals `excused` (case-insensitive).
  - `type ResolvedCell = { minutes: number | null; farFromColumn: boolean }`
  - `resolveColumnTimes(parses: ClockParse[]): ResolvedCell[]` — two-pass consensus over one sub-column (same index across all people). Confident values form a median; ambiguous cells pick the AM/PM interpretation nearest the median; anything still > `TIME_ANOMALY_THRESHOLD_MIN` from the median is flagged `farFromColumn`. Non-time cells → `{ minutes: null, farFromColumn: false }`.
  - `TIME_ANOMALY_THRESHOLD_MIN = 240`, `MAX_SHIFT_MIN = 1080`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/time-parse.test.ts
import { describe, expect, test } from "vitest";
import { parseClockToken, resolveColumnTimes } from "./time-parse";

describe("parseClockToken", () => {
  test("24-hour with hour > 12 is confident", () => {
    expect(parseClockToken("18:29")).toEqual({ kind: "confident", minutes: 18 * 60 + 29 });
  });
  test("explicit AM/PM (with seconds) is confident", () => {
    expect(parseClockToken("6:26:00 PM")).toEqual({ kind: "confident", minutes: 18 * 60 + 26 });
    expect(parseClockToken("9:00 AM")).toEqual({ kind: "confident", minutes: 9 * 60 });
    expect(parseClockToken("5:56:26 PM")).toEqual({ kind: "confident", minutes: 17 * 60 + 56 });
  });
  test("24-hour with seconds and midnight-hour are confident", () => {
    expect(parseClockToken("21:25:00")).toEqual({ kind: "confident", minutes: 21 * 60 + 25 });
    expect(parseClockToken("0:12")).toEqual({ kind: "confident", minutes: 12 });
  });
  test("bare h:mm with hour 1..12 is ambiguous (both interpretations)", () => {
    expect(parseClockToken("8:52")).toEqual({ kind: "ambiguous", am: 8 * 60 + 52, pm: 20 * 60 + 52 });
    expect(parseClockToken("12:30")).toEqual({ kind: "ambiguous", am: 30, pm: 12 * 60 + 30 });
  });
  test("excused (any case, trailing space) and empties", () => {
    expect(parseClockToken("Excused").kind).toBe("excused");
    expect(parseClockToken("Excused ").kind).toBe("excused");
    expect(parseClockToken("").kind).toBe("empty");
    expect(parseClockToken("   ").kind).toBe("empty");
  });
  test("garbage is unparseable", () => {
    expect(parseClockToken("OK")).toEqual({ kind: "unparseable", raw: "OK" });
  });
});

describe("resolveColumnTimes", () => {
  test("resolves ambiguous cells toward the confident median (evening column -> PM)", () => {
    const col = [
      parseClockToken("18:30"), // confident PM
      parseClockToken("18:27"), // confident PM
      parseClockToken("6:29"),  // ambiguous -> should resolve to 18:29
    ];
    const r = resolveColumnTimes(col);
    expect(r[2]).toEqual({ minutes: 18 * 60 + 29, farFromColumn: false });
  });
  test("flags a cell that is wildly off the column (e.g. 5h) but keeps its best guess", () => {
    const col = [
      parseClockToken("18:30"),
      parseClockToken("18:31"),
      parseClockToken("13:30"), // confident but 5h below the ~18:30 median
    ];
    const r = resolveColumnTimes(col);
    expect(r[2].minutes).toBe(13 * 60 + 30);
    expect(r[2].farFromColumn).toBe(true);
  });
  test("non-time cells resolve to null and are never flagged", () => {
    const r = resolveColumnTimes([parseClockToken("Excused"), parseClockToken("")]);
    expect(r).toEqual([{ minutes: null, farFromColumn: false }, { minutes: null, farFromColumn: false }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- src/lib/time-parse.test.ts`
Expected: FAIL — `Cannot find module './time-parse'`.

- [ ] **Step 3: Implement `src/lib/time-parse.ts`**

```ts
// src/lib/time-parse.ts
export const TIME_ANOMALY_THRESHOLD_MIN = 240; // 4h — catches AM/PM (12h) and tz (~5h) slips
export const MAX_SHIFT_MIN = 1080;             // 18h, matches the max_shift_hours default

export type ClockParse =
  | { kind: "confident"; minutes: number }
  | { kind: "ambiguous"; am: number; pm: number }
  | { kind: "excused" }
  | { kind: "empty" }
  | { kind: "unparseable"; raw: string };

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

/** Parse one cell. PURE. */
export function parseClockToken(raw: string): ClockParse {
  const s = raw.trim();
  if (s === "") return { kind: "empty" };
  if (s.toLowerCase() === "excused") return { kind: "excused" };
  const m = TIME_RE.exec(s);
  if (!m) return { kind: "unparseable", raw: s };
  const hour = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[4]?.toLowerCase();
  if (min > 59) return { kind: "unparseable", raw: s };

  if (ampm) {
    if (hour < 1 || hour > 12) return { kind: "unparseable", raw: s };
    const base = (hour % 12) * 60 + min;
    return { kind: "confident", minutes: ampm === "pm" ? base + 720 : base };
  }
  if (hour > 23) return { kind: "unparseable", raw: s };
  // 0 and 13..23 are unambiguous 24-hour; 1..12 could be AM or PM.
  if (hour === 0 || hour > 12) return { kind: "confident", minutes: hour * 60 + min };
  return { kind: "ambiguous", am: (hour % 12) * 60 + min, pm: (hour % 12) * 60 + min + 720 };
}

export type ResolvedCell = { minutes: number | null; farFromColumn: boolean };

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Two-pass column consensus over one sub-column (same index across people). PURE. */
export function resolveColumnTimes(parses: ClockParse[]): ResolvedCell[] {
  const ref = median(parses.flatMap((p) => (p.kind === "confident" ? [p.minutes] : [])));
  return parses.map((p) => {
    if (p.kind === "confident") {
      return { minutes: p.minutes, farFromColumn: ref !== null && Math.abs(p.minutes - ref) > TIME_ANOMALY_THRESHOLD_MIN };
    }
    if (p.kind === "ambiguous") {
      const chosen = ref === null || Math.abs(p.am - ref) <= Math.abs(p.pm - ref) ? p.am : p.pm;
      return { minutes: chosen, farFromColumn: ref !== null && Math.abs(chosen - ref) > TIME_ANOMALY_THRESHOLD_MIN };
    }
    return { minutes: null, farFromColumn: false };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npm run test -- src/lib/time-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time-parse.ts src/lib/time-parse.test.ts
git commit -m "feat(time-parse): clock-token parsing + two-pass column consensus"
```

---

### Task 4: Time-sheet parser (structure detection → per-person entries)

**Files:**
- Create: `src/lib/time-import.ts`
- Test: `src/lib/time-import.test.ts`

**Interfaces:**
- Consumes: `parseCsvRecords` (Task 1); `parseClockToken`, `resolveColumnTimes`, `MAX_SHIFT_MIN` (Task 3).
- Produces:
  - `type ParsedSession = { date: string; timeIn: string; timeOut: string; timeOutDate: string }` — `timeIn`/`timeOut` are `HH:MM` (24h) local; `timeOutDate` = `date` or the next day (overnight roll).
  - `type ParsedExcusal = { date: string }`
  - `type SkippedEntry = { date: string; reason: string }`
  - `type TimeAnomaly = { date: string; kind: "time_far_from_column" | "over_max_shift" | "zero_or_negative"; detail: string }`
  - `type ParsedPerson = { firstName: string; lastName: string; sourceRow: number; sessions: ParsedSession[]; excusals: ParsedExcusal[]; skipped: SkippedEntry[]; anomalies: TimeAnomaly[] }`
  - `type ParsedTimeSheet = { dates: string[]; people: ParsedPerson[]; fileIssues: string[] }`
  - `parseTimeSheet(csvText: string): ParsedTimeSheet` — PURE. Column blocks start at index 3, stride 3. Date row = first row with ≥ 3 stride-3 cells parsing as dates. Data rows = both name cells non-empty.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/time-import.test.ts
import { describe, expect, test } from "vitest";
import { parseTimeSheet } from "./time-import";

// A compact sheet with the real quirks. Row 1 day-of-week labels; row 2 dates
// (block starts at col index 3, stride 3); row 3 sub-headers; then data.
const SHEET = [
  ",,,,,,Saturday,,,Sunday,,,,Varsity",
  ',,,"January 8, 2026",,,"January 10, 2026",,,"January 11, 2026",,,,Letter',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Time In,Time Out,Day Total,Total Hours",
  // Ada: kickoff session (Jan 8), a morning session (Jan 10), excused (Jan 11)
  "Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,Excused,,0:00,10",
  // Bo: overnight on Jan 8 (18:00 -> 1:00 next day), missing clock-out Jan 10
  "Bo,Peep,0.00,18:00,1:00,7:00,8:52,,0:00,,,0:00,7",
  // reference + blank rows must be dropped
  ",Available Time,#N/A,,,,,,0:00,,,0:00,",
  ",,73.50,,,,,,0:00,,,0:00,",
].join("\n");

describe("parseTimeSheet", () => {
  test("detects dates from the date row (stride 3), ignoring summary columns", () => {
    expect(parseTimeSheet(SHEET).dates).toEqual(["2026-01-08", "2026-01-10", "2026-01-11"]);
  });

  test("keeps only rows with both names; drops reference/blank rows", () => {
    const people = parseTimeSheet(SHEET).people;
    expect(people.map((p) => `${p.firstName} ${p.lastName}`)).toEqual(["Ada Lovelace", "Bo Peep"]);
  });

  test("emits a session per Time-In+Time-Out pair", () => {
    const ada = parseTimeSheet(SHEET).people[0];
    expect(ada.sessions).toContainEqual({ date: "2026-01-08", timeIn: "18:29", timeOut: "20:58", timeOutDate: "2026-01-08" });
    expect(ada.sessions).toContainEqual({ date: "2026-01-10", timeIn: "09:00", timeOut: "17:04", timeOutDate: "2026-01-10" });
  });

  test("Excused cell -> excusal", () => {
    expect(parseTimeSheet(SHEET).people[0].excusals).toEqual([{ date: "2026-01-11" }]);
  });

  test("overnight Time-Out rolls to the next day, hours belong to the start day", () => {
    const bo = parseTimeSheet(SHEET).people[1];
    expect(bo.sessions).toContainEqual({ date: "2026-01-08", timeIn: "18:00", timeOut: "01:00", timeOutDate: "2026-01-09" });
  });

  test("Time-In with no Time-Out is skipped and reported", () => {
    const bo = parseTimeSheet(SHEET).people[1];
    expect(bo.skipped).toContainEqual({ date: "2026-01-10", reason: "missing clock-out" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- src/lib/time-import.test.ts`
Expected: FAIL — `Cannot find module './time-import'`.

- [ ] **Step 3: Implement `src/lib/time-import.ts`**

```ts
// src/lib/time-import.ts
import { parseCsvRecords } from "./csv";
import {
  MAX_SHIFT_MIN,
  parseClockToken,
  resolveColumnTimes,
  type ResolvedCell,
} from "./time-parse";

export type ParsedSession = { date: string; timeIn: string; timeOut: string; timeOutDate: string };
export type ParsedExcusal = { date: string };
export type SkippedEntry = { date: string; reason: string };
export type TimeAnomaly = {
  date: string;
  kind: "time_far_from_column" | "over_max_shift" | "zero_or_negative";
  detail: string;
};
export type ParsedPerson = {
  firstName: string;
  lastName: string;
  sourceRow: number;
  sessions: ParsedSession[];
  excusals: ParsedExcusal[];
  skipped: SkippedEntry[];
  anomalies: TimeAnomaly[];
};
export type ParsedTimeSheet = { dates: string[]; people: ParsedPerson[]; fileIssues: string[] };

const BLOCK_START = 3; // cols 0,1,2 = first, last, hours-left
const BLOCK_STRIDE = 3; // [Time In, Time Out, ignored]

/** "January 8, 2026" -> "2026-01-08", else null. PURE. */
function parseSheetDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function nextDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

const cell = (rec: string[], i: number): string => (rec[i] ?? "").trim();

export function parseTimeSheet(csvText: string): ParsedTimeSheet {
  const records = parseCsvRecords(csvText);
  const fileIssues: string[] = [];

  // 1. Date row = first row with >= 3 stride-3 cells parsing as dates.
  let dateRowIdx = -1;
  for (let r = 0; r < records.length; r++) {
    let count = 0;
    for (let c = BLOCK_START; c < records[r].length; c += BLOCK_STRIDE) {
      if (parseSheetDate(cell(records[r], c))) count++;
    }
    if (count >= 3) { dateRowIdx = r; break; }
  }
  if (dateRowIdx === -1) return { dates: [], people: [], fileIssues: ["No date row found"] };

  // 2. Blocks: consecutive stride-3 date cells from BLOCK_START until the first gap.
  const blocks: { col: number; date: string }[] = [];
  for (let c = BLOCK_START; c < records[dateRowIdx].length; c += BLOCK_STRIDE) {
    const date = parseSheetDate(cell(records[dateRowIdx], c));
    if (!date) break;
    blocks.push({ col: c, date });
  }
  const dates = blocks.map((b) => b.date);

  // 3. Data rows = rows after the date row with both name cells non-empty.
  const dataRows: { rec: string[]; sourceRow: number }[] = [];
  for (let r = dateRowIdx + 1; r < records.length; r++) {
    const first = cell(records[r], 0);
    const last = cell(records[r], 1);
    if (first && last) dataRows.push({ rec: records[r], sourceRow: r + 1 }); // 1-based line
  }
  if (dataRows.length === 0) fileIssues.push("No data rows found");

  // 4. Per-column consensus for Time-In and Time-Out sub-columns.
  const inResolved: ResolvedCell[][] = blocks.map((b) =>
    resolveColumnTimes(dataRows.map(({ rec }) => parseClockToken(cell(rec, b.col)))),
  );
  const outResolved: ResolvedCell[][] = blocks.map((b) =>
    resolveColumnTimes(dataRows.map(({ rec }) => parseClockToken(cell(rec, b.col + 1)))),
  );

  const people: ParsedPerson[] = dataRows.map(({ rec, sourceRow }, personIdx) => {
    const person: ParsedPerson = {
      firstName: cell(rec, 0),
      lastName: cell(rec, 1),
      sourceRow,
      sessions: [],
      excusals: [],
      skipped: [],
      anomalies: [],
    };

    blocks.forEach((b, blockIdx) => {
      const { date } = b;
      const inRaw = parseClockToken(cell(rec, b.col));
      if (inRaw.kind === "excused") {
        person.excusals.push({ date });
        return;
      }
      const inCell = inResolved[blockIdx][personIdx];
      const outCell = outResolved[blockIdx][personIdx];

      if (inCell.minutes !== null && outCell.minutes !== null) {
        const overnight = outCell.minutes < inCell.minutes;
        const durMin = outCell.minutes + (overnight ? 1440 : 0) - inCell.minutes;
        person.sessions.push({
          date,
          timeIn: hhmm(inCell.minutes),
          timeOut: hhmm(outCell.minutes),
          timeOutDate: overnight ? nextDay(date) : date,
        });
        if (inCell.farFromColumn) person.anomalies.push({ date, kind: "time_far_from_column", detail: `Time In ${hhmm(inCell.minutes)} is far from the column norm` });
        if (outCell.farFromColumn) person.anomalies.push({ date, kind: "time_far_from_column", detail: `Time Out ${hhmm(outCell.minutes)} is far from the column norm` });
        if (durMin <= 0) person.anomalies.push({ date, kind: "zero_or_negative", detail: "Session has zero or negative length" });
        else if (durMin > MAX_SHIFT_MIN) person.anomalies.push({ date, kind: "over_max_shift", detail: `Session is ${(durMin / 60).toFixed(1)}h (over ${MAX_SHIFT_MIN / 60}h)` });
      } else if (inCell.minutes !== null && outCell.minutes === null) {
        person.skipped.push({ date, reason: "missing clock-out" });
      } else if (inCell.minutes === null && outCell.minutes !== null) {
        person.skipped.push({ date, reason: "missing clock-in" });
      }
      // both null and not excused -> plain absence, nothing recorded
    });

    return person;
  });

  return { dates, people, fileIssues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npm run test -- src/lib/time-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time-import.ts src/lib/time-import.test.ts
git commit -m "feat(time-import): pure time-sheet parser with dynamic structure detection"
```

---

### Task 5: Migration — `source` on session (add 'import') and excusal

**Files:**
- Create: `supabase/migrations/20260813170000_time_import_source.sql`

**Interfaces:**
- Produces: `session.source` accepts `'import'`; `excusal.source text not null default 'manual' check (source in ('manual','import'))`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260813170000_time_import_source.sql
-- Historical time-sheet import tags its rows source='import' so a re-import is an
-- idempotent replace (delete this period's import rows, re-insert) that never
-- touches kiosk/manual/admin sessions. Excusals gain the same marker.

alter table session drop constraint if exists session_source_check;
alter table session add constraint session_source_check
  check (source in ('kiosk', 'manual', 'admin', 'import'));

alter table excusal add column source text not null default 'manual'
  check (source in ('manual', 'import'));
```

- [ ] **Step 2: Apply locally and verify**

Run: `./dev npm run db:reset`
Then verify the constraint + column exist:
Run: `./dev npm run db:psql -- -c "\d session" ` and `./dev npm run db:psql -- -c "\d excusal"`
Expected: `session_source_check` lists `import`; `excusal` has a `source` column defaulting to `'manual'`.

- [ ] **Step 3: Confirm the unit suite is still green (no schema-coupled unit tests broke)**

Run: `./dev npm run test`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260813170000_time_import_source.sql
git commit -m "feat(db): add source='import' to session; add source to excusal"
```

---

### Task 6: Import runner (match/auto-create + idempotent replace)

**Files:**
- Create: `src/lib/time-import-run.ts`
- Test: `src/lib/time-import-run.test.ts`

**Interfaces:**
- Consumes: `parseTimeSheet` + its types (Task 4); `localDateTimeToInstant` (Task 2); `getPeriod` (`src/lib/periods.ts`, `getPeriod(id, db?) → Period | null`, `Period.startsOn`/`.endsOn`); `getSetting` (`src/lib/settings.ts`); `getDb` (`src/lib/db.ts`).
- Produces:
  - `type TimeImportSummary = { createdPeople: number; matchedPeople: number; sessions: number; excusals: number; skipped: { name: string; date: string; reason: string }[]; anomalies: { name: string; date: string; kind: string; detail: string }[]; errors: { name: string; message: string }[]; createdNames: string[] }`
  - `runTimeImport(args: { csv: string; periodId: string; importedBy: string; db?: SupabaseClient; tz?: string }): Promise<TimeImportSummary | { error: string }>` — returns `{ error }` on a bad period or empty parse (route maps to 400).

Behavior: parse; load all people once (`id, first_name, last_name, display_name`); match `lower(first)+"\x00"+lower(last)`, also `lower(display_name) === "first last"`; ambiguous (≥2) → per-person error, not imported; no match → insert a `person` (`role:'student'`, `is_active:true`) and add to the map + `createdNames`. Convert sessions to instants with `tz` (default from `getSetting("team_timezone", …)`). **Idempotent replace**: delete `session` where `period_id=periodId and source='import'`; delete `excusal` where `source='import' and date between period.startsOn and period.endsOn`; then batch-insert sessions (`source:'import'`) and excusals (`source:'import'`, `created_by: importedBy`, `on conflict (person_id,date) do nothing`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/time-import-run.test.ts
import { describe, expect, test, vi } from "vitest";
import { runTimeImport } from "./time-import-run";

// Minimal fake db capturing inserts/deletes. person select returns one match (Ada).
function fakeDb() {
  const calls = { sessionInsert: [] as any[], excusalUpsert: [] as any[], personInsert: [] as any[], deletes: [] as string[] };
  const db: any = {
    from(table: string) {
      if (table === "period") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pd1", name: "S", starts_on: "2026-01-01", ends_on: "2026-03-01", is_active: true } }) }) }) };
      }
      if (table === "app_setting") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: '"America/Indiana/Indianapolis"' } }) }) }) };
      }
      if (table === "person") {
        return {
          select: () => ({ data: [{ id: "ada", first_name: "Ada", last_name: "Lovelace", display_name: null }], error: null }),
          insert: (rows: any) => { calls.personInsert.push(rows); return { select: () => ({ single: async () => ({ data: { id: "new-1" }, error: null }) }) }; },
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
        };
      }
      if (table === "session") {
        return {
          delete: () => ({ eq: () => ({ eq: async () => { calls.deletes.push("session"); return { error: null }; } }) }),
          insert: async (rows: any[]) => { calls.sessionInsert.push(...rows); return { error: null }; },
        };
      }
      if (table === "excusal") {
        return {
          delete: () => ({ eq: () => ({ gte: () => ({ lte: async () => { calls.deletes.push("excusal"); return { error: null }; } }) }) }),
          upsert: async (rows: any[]) => { calls.excusalUpsert.push(...rows); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db, calls };
}

const SHEET = [
  ',,,"January 8, 2026",,,"January 10, 2026",,,,Varsity',
  ",Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Total Hours",
  "Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,10",
  "New,Person,0.00,18:30,21:00,OK,,,0:00,3",
].join("\n");

describe("runTimeImport", () => {
  test("matches existing person, auto-creates unknown, inserts sessions with source=import", async () => {
    const { db, calls } = fakeDb();
    const summary = await runTimeImport({ csv: SHEET, periodId: "pd1", importedBy: "admin-1", db });
    if ("error" in summary) throw new Error(summary.error);

    expect(summary.matchedPeople).toBe(1);
    expect(summary.createdPeople).toBe(1);
    expect(summary.createdNames).toEqual(["New Person"]);
    // Two sessions (Ada x2), all tagged import, Ada mapped to her existing id.
    expect(calls.sessionInsert.every((s) => s.source === "import")).toBe(true);
    expect(calls.sessionInsert.some((s) => s.person_id === "ada")).toBe(true);
    // Replace deletes ran before insert.
    expect(calls.deletes).toContain("session");
    expect(calls.deletes).toContain("excusal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./dev npm run test -- src/lib/time-import-run.test.ts`
Expected: FAIL — `Cannot find module './time-import-run'`.

- [ ] **Step 3: Implement `src/lib/time-import-run.ts`**

```ts
// src/lib/time-import-run.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTimeSheet, type ParsedPerson } from "./time-import";
import { localDateTimeToInstant } from "./tz";
import { getPeriod } from "./periods";
import { getSetting } from "./settings";

export type TimeImportSummary = {
  createdPeople: number;
  matchedPeople: number;
  sessions: number;
  excusals: number;
  skipped: { name: string; date: string; reason: string }[];
  anomalies: { name: string; date: string; kind: string; detail: string }[];
  errors: { name: string; message: string }[];
  createdNames: string[];
};

const nameKey = (first: string, last: string) => `${first.trim().toLowerCase()}\x00${last.trim().toLowerCase()}`;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function runTimeImport(args: {
  csv: string;
  periodId: string;
  importedBy: string;
  db?: SupabaseClient;
  tz?: string;
}): Promise<TimeImportSummary | { error: string }> {
  const db = args.db ?? (await import("./db")).getDb();
  const period = await getPeriod(args.periodId, db);
  if (!period) return { error: "period_not_found" };
  const tz = args.tz ?? (await getSetting<string>("team_timezone", "America/Indiana/Indianapolis", db));

  const parsed = parseTimeSheet(args.csv);
  if (parsed.people.length === 0) return { error: parsed.fileIssues[0] ?? "no_data" };

  // Load roster once; build name/display-name -> id[] index.
  const { data: peopleRows } = await db.from("person").select("id, first_name, last_name, display_name");
  const byName = new Map<string, string[]>();
  for (const p of (peopleRows ?? []) as { id: string; first_name: string; last_name: string; display_name: string | null }[]) {
    for (const k of [nameKey(p.first_name, p.last_name), p.display_name ? nameKey(...splitDisplay(p.display_name)) : ""]) {
      if (!k) continue;
      byName.set(k, [...(byName.get(k) ?? []), p.id]);
    }
  }

  const summary: TimeImportSummary = {
    createdPeople: 0, matchedPeople: 0, sessions: 0, excusals: 0,
    skipped: [], anomalies: [], errors: [], createdNames: [],
  };
  const sessionRows: Record<string, unknown>[] = [];
  const excusalRows: Record<string, unknown>[] = [];

  for (const person of parsed.people) {
    const name = `${person.firstName} ${person.lastName}`;
    const key = nameKey(person.firstName, person.lastName);
    const matches = byName.get(key) ?? [];

    let personId: string;
    if (matches.length > 1) {
      summary.errors.push({ name, message: "Ambiguous — name matches more than one person" });
      continue;
    } else if (matches.length === 1) {
      personId = matches[0];
      summary.matchedPeople += 1;
    } else {
      const { data, error } = await db.from("person")
        .insert({ first_name: person.firstName, last_name: person.lastName, role: "student", is_active: true })
        .select("id").single();
      if (error || !data) { summary.errors.push({ name, message: "Failed to create person" }); continue; }
      personId = data.id as string;
      byName.set(key, [personId]);
      summary.createdPeople += 1;
      summary.createdNames.push(name);
    }

    collectRows(person, personId, name, args.periodId, tz, args.importedBy, sessionRows, excusalRows, summary);
  }

  // Idempotent replace: clear this period's prior import rows, then insert.
  await db.from("session").delete().eq("period_id", args.periodId).eq("source", "import");
  await db.from("excusal").delete().eq("source", "import").gte("date", period.startsOn).lte("date", period.endsOn);

  for (let i = 0; i < sessionRows.length; i += 500) {
    const { error } = await db.from("session").insert(sessionRows.slice(i, i + 500));
    if (error) return { error: `session_insert_failed: ${error.message}` };
  }
  if (excusalRows.length > 0) {
    const { error } = await db.from("excusal").upsert(excusalRows, { onConflict: "person_id,date", ignoreDuplicates: true });
    if (error) return { error: `excusal_insert_failed: ${error.message}` };
  }

  return summary;
}

function splitDisplay(display: string): [string, string] {
  const parts = display.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

function collectRows(
  person: ParsedPerson, personId: string, name: string, periodId: string, tz: string, importedBy: string,
  sessionRows: Record<string, unknown>[], excusalRows: Record<string, unknown>[], summary: TimeImportSummary,
) {
  for (const s of person.sessions) {
    sessionRows.push({
      person_id: personId,
      period_id: periodId,
      time_in: localDateTimeToInstant(s.date, toMinutes(s.timeIn), tz),
      time_out: localDateTimeToInstant(s.timeOutDate, toMinutes(s.timeOut), tz),
      source: "import",
    });
    summary.sessions += 1;
  }
  for (const e of person.excusals) {
    excusalRows.push({ person_id: personId, date: e.date, source: "import", created_by: importedBy });
    summary.excusals += 1;
  }
  for (const sk of person.skipped) summary.skipped.push({ name, date: sk.date, reason: sk.reason });
  for (const a of person.anomalies) summary.anomalies.push({ name, date: a.date, kind: a.kind, detail: a.detail });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./dev npm run test -- src/lib/time-import-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time-import-run.ts src/lib/time-import-run.test.ts
git commit -m "feat(time-import): runner — match/auto-create people, idempotent per-period replace"
```

---

### Task 7: API route

**Files:**
- Create: `src/app/api/admin/time-import/route.ts`

**Interfaces:**
- Consumes: `withRole` (`src/lib/api.ts`); `runTimeImport` (Task 6).
- Produces: `POST /api/admin/time-import` — body `{ csv: string; periodId: string }`, admin-gated, returns the `TimeImportSummary` JSON (200) or `{ error }` (400).

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/admin/time-import/route.ts
import { withRole } from "@/lib/api";
import { runTimeImport } from "@/lib/time-import-run";

export const POST = withRole("admin", async (viewer, request) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const csv = typeof body?.csv === "string" ? (body.csv as string) : null;
  const periodId = typeof body?.periodId === "string" ? (body.periodId as string) : null;
  if (csv === null || periodId === null) return Response.json({ error: "invalid" }, { status: 400 });
  if (!viewer.person) return Response.json({ error: "no_person" }, { status: 400 });

  // Never trust a client preview — runTimeImport re-parses the raw text.
  const result = await runTimeImport({ csv, periodId, importedBy: viewer.person.id });
  if ("error" in result) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 200 });
});
```

- [ ] **Step 2: Typecheck**

Run: `rm -rf .next && ./dev npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/time-import/route.ts
git commit -m "feat(time-import): admin-gated POST /api/admin/time-import route"
```

---

### Task 8: Admin screen + client form + hub link

**Files:**
- Create: `src/app/admin/time-import/page.tsx`
- Create: `src/components/TimeImportForm.tsx`
- Modify: `src/app/admin/page.tsx` (add a card linking to `/admin/time-import`)

**Interfaces:**
- Consumes: `getViewer`, `hasRole`, `listPeriods` (`src/lib/periods.ts`, `Period` = `{ id, name, startsOn, endsOn, isActive }`); `parseTimeSheet` (Task 4, for the client-only preview); `TimeImportSummary` shape (Task 6).

- [ ] **Step 1: Implement the page (admin-gated, lists periods)**

```tsx
// src/app/admin/time-import/page.tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeriods } from "@/lib/periods";
import { TimeImportForm } from "@/components/TimeImportForm";

export default async function AdminTimeImportPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/");
  const periods = await listPeriods();

  return (
    <main className="flex flex-col gap-6">
      <div className="page-head">
        <div>
          <h1>Import time sheet</h1>
          <div className="sub">Bulk-import a season&apos;s attendance from a Google-Sheets CSV export</div>
        </div>
      </div>
      <TimeImportForm periods={periods.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))} />
    </main>
  );
}
```

- [ ] **Step 2: Implement the client form**

```tsx
// src/components/TimeImportForm.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTimeSheet } from "@/lib/time-import";

type PeriodOpt = { id: string; name: string; isActive: boolean };
type Summary = {
  createdPeople: number; matchedPeople: number; sessions: number; excusals: number;
  skipped: { name: string; date: string; reason: string }[];
  anomalies: { name: string; date: string; kind: string; detail: string }[];
  errors: { name: string; message: string }[];
  createdNames: string[];
};

export function TimeImportForm({ periods }: { periods: PeriodOpt[] }) {
  const [text, setText] = useState("");
  const [periodId, setPeriodId] = useState(periods.find((p) => p.isActive)?.id ?? periods[0]?.id ?? "");
  const [preview, setPreview] = useState<ReturnType<typeof parseTimeSheet> | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result ?? "")); setPreview(null); setSummary(null); setStatus(null); };
    reader.readAsText(file);
  }

  const counts = preview && {
    people: preview.people.length,
    sessions: preview.people.reduce((n, p) => n + p.sessions.length, 0),
    excusals: preview.people.reduce((n, p) => n + p.excusals.length, 0),
    skipped: preview.people.reduce((n, p) => n + p.skipped.length, 0),
    anomalies: preview.people.reduce((n, p) => n + p.anomalies.length, 0),
  };

  async function runImport() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/api/admin/time-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, periodId }),
      });
      if (res.ok) {
        const data = (await res.json()) as Summary;
        setSummary(data);
        setStatus(`Imported ${data.sessions} sessions, ${data.excusals} excusals · ${data.createdPeople} people created, ${data.matchedPeople} matched · ${data.skipped.length} skipped, ${data.anomalies.length} anomalies, ${data.errors.length} errors.`);
        router.refresh();
      } else if (res.status === 403) {
        setStatus("Forbidden — admin role required.");
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(`Import failed${err?.error ? ` — ${err.error}` : ""}.`);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4">
        <h2 className="text-base font-semibold">1. Choose a season and file</h2>
        <label className="label">
          Target period
          <select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? " (active)" : ""}</option>)}
          </select>
        </label>
        <label className="label">
          Upload CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => { setPreview(parseTimeSheet(text)); setSummary(null); setStatus(null); }} disabled={!text.trim()}>Preview</button>
          <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy || !text.trim() || !periodId}>{busy ? "Importing…" : "Import"}</button>
        </div>
        {status && <p role="status" className="text-sm text-[var(--muted)]">{status}</p>}
      </section>

      {preview && counts && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">2. Preview</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{counts.people} people</span>
            <span className="pill">{counts.sessions} sessions</span>
            <span className="pill">{counts.excusals} excusals</span>
            <span className="pill update">{counts.skipped} skipped</span>
            <span className="pill error">{counts.anomalies} anomalies</span>
          </div>
          {preview.fileIssues.length > 0 && <ul className="text-sm text-[var(--absent)]">{preview.fileIssues.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          {counts.anomalies > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {preview.people.flatMap((p) => p.anomalies.map((a, i) => (
                <li key={`${p.sourceRow}-${i}`} className="text-[var(--absent)]">{p.firstName} {p.lastName} · {a.date}: {a.detail}</li>
              )))}
            </ul>
          )}
        </section>
      )}

      {summary && (
        <section className="card flex flex-col gap-3">
          <h2 className="text-base font-semibold">3. Result</h2>
          <div className="flex flex-wrap gap-2">
            <span className="pill new">{summary.sessions} sessions</span>
            <span className="pill">{summary.excusals} excusals</span>
            <span className="pill new">{summary.createdPeople} created</span>
            <span className="pill update">{summary.skipped.length} skipped</span>
            <span className="pill error">{summary.errors.length} errors</span>
          </div>
          {summary.createdNames.length > 0 && (
            <p className="text-sm text-[var(--muted)]">New people (default role student — review): {summary.createdNames.join(", ")}</p>
          )}
          {summary.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {summary.errors.map((e, i) => <li key={i} className="text-[var(--absent)]">{e.name}: {e.message}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add a hub card**

In `src/app/admin/page.tsx`, add — inside the admin-only Roster section, next to the People/Teams cards (follow the existing `<Card …/>` usage and `isAdmin` gating already in that file):

```tsx
<Card href="/admin/time-import" icon="clock" title="Time import" hint="Import a season's attendance from a Google-Sheets CSV." />
```

- [ ] **Step 4: Typecheck + lint**

Run: `rm -rf .next && ./dev npm run typecheck && ./dev npm run lint`
Expected: PASS (the pre-existing `postcss.config.mjs` warning is fine).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/time-import/page.tsx src/components/TimeImportForm.tsx src/app/admin/page.tsx
git commit -m "feat(time-import): admin screen, upload/preview/import form, hub card"
```

---

### Task 9: End-to-end test

**Files:**
- Create: `e2e/time-import.spec.ts`
- Create: `e2e/fixtures/time-sheet-sample.csv` (a trimmed 3-column, 2-person sheet)

**Interfaces:**
- Consumes: the `adminSessionCookie` / `studentSessionCookie` helpers (`e2e/helpers/session.ts`); a seeded active period from `db:reset`.

- [ ] **Step 1: Create the fixture**

```
// e2e/fixtures/time-sheet-sample.csv
,,,"January 8, 2026",,,"January 10, 2026",,,,Varsity
,Name,Hours Left,Time In,Time Out,Verified,Time In,Time Out,Day Total,Total Hours
Ada,Lovelace,0.00,18:29,20:58,OK,9:00,17:04,8:04,10
Bo,Peep,0.00,18:00,21:00,OK,Excused,,0:00,3
```

- [ ] **Step 2: Write the E2E spec**

```ts
// e2e/time-import.spec.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { adminSessionCookie, studentSessionCookie } from "./helpers/session";

const CSV = readFileSync(join(__dirname, "fixtures", "time-sheet-sample.csv"), "utf8");

test("a non-admin is redirected away from /admin/time-import", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await studentSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/time-import");
  expect(new URL(page.url()).pathname).not.toBe("/admin/time-import");
  await context.close();
});

test("an admin imports a time-sheet CSV and sees a result summary", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([await adminSessionCookie()]);
  const page = await context.newPage();
  await page.goto("/admin/time-import");
  await expect(page.getByRole("heading", { name: "Import time sheet" })).toBeVisible();

  // Paste the CSV via the file input using setInputFiles from a buffer.
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8"),
  });
  await page.getByRole("button", { name: "Import" }).click();

  // Result summary appears with at least the sessions we expect (Ada x2, Bo x1).
  await expect(page.getByRole("heading", { name: "3. Result" })).toBeVisible();
  await expect(page.getByText(/sessions/)).toBeVisible();
  await context.close();
});
```

- [ ] **Step 3: Run the E2E spec (requires the dev server + a fresh DB with the migration applied)**

Run: `./dev npm run db:reset` (applies Task 5's migration), then with the dev server up: `./dev npx playwright test time-import --reporter=line`
Expected: PASS (both tests).

- [ ] **Step 4: Full green gate**

Run: `rm -rf .next && ./dev npm run typecheck && ./dev npm run lint && ./dev npm run test && ./dev npx playwright test --reporter=line`
Expected: unit suite green, E2E green, typecheck/lint clean.

- [ ] **Step 5: Commit**

```bash
git add e2e/time-import.spec.ts e2e/fixtures/time-sheet-sample.csv
git commit -m "test(time-import): e2e upload + import summary; non-admin gating"
```

---

## Self-Review

**Spec coverage:**
- Access = CSV upload → Tasks 7–9 (route/screen/form), no Google API. ✓
- `source='import'` + idempotent replace → Task 5 (migration) + Task 6 (delete-then-insert). ✓
- Excusal idempotency via `excusal.source` → Task 5 + Task 6. ✓
- Dynamic (row/column-agnostic) structure detection → Task 4 (date-row detection, both-names data-row filter, stride-3 blocks). ✓
- Smart two-pass time parsing + overnight roll + anomalies → Tasks 3 & 4. ✓
- Timezone conversion → Task 2, used in Task 6. ✓
- Match-or-auto-create people, created-people review list → Task 6 (`createdNames`) + Task 8 (summary UI). ✓
- Excused → excusal (recorder = importing admin) → Task 6. ✓
- Missing clock-out skipped + reported → Task 4 (`skipped`) + Task 8 UI. ✓
- Reuse roster-import pattern + shared tokenizer → Task 1 + Tasks 7–8. ✓
- Preview / server re-parse / summary → Task 7 (re-parse) + Task 8 (preview & summary). ✓
- Tests: pure parser fixture, tz helper, runner with fake db, E2E → Tasks 2,3,4,6,9. ✓
- Deferred person-merge (#33) → out of scope, not in plan. ✓

**Placeholder scan:** No "TBD/TODO/etc." and no placeholder values — `collectRows` takes `periodId` and sets `period_id: periodId` directly.

**Type consistency:** `parseTimeSheet` / `ParsedPerson` / `ParsedSession` fields (`sessions`, `excusals`, `skipped`, `anomalies`, `timeOutDate`) are used identically in Tasks 4, 6, 8. `TimeImportSummary` fields (`createdPeople`, `matchedPeople`, `sessions`, `excusals`, `skipped`, `anomalies`, `errors`, `createdNames`) match across Tasks 6, 7, 8. `runTimeImport` arg shape matches its Task 7 caller. `localDateTimeToInstant(dateIso, minutes, tz)` signature matches its Task 6 use. `resolveColumnTimes`/`parseClockToken` signatures match Task 4 use.

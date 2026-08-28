# Milestone 2: Roster & Teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Person CRUD with role-scoped roster views, the team tree with memberships/join modes/application queue, the account-request review queue, and the three M1 carry-forwards (email normalization, public-route hardening, middleware session refresh) — turning the auth skeleton into a usable roster app.

**Architecture:** Follows M1's established seams exactly. Reads happen in **server components** that call typed query functions in `src/lib/` (service-role db via `getDb()`, guest/role scoping applied in code). Mutations happen in **API route handlers** wrapped in `withRole` (extended in Task 2 to pass through Next's route context so `[id]` params work), with small fetch-based client components for forms — the same pattern as `StudentLoginForm`. All pure logic (tree building, join-mode rules, roster scoping, validation, rate limiting) lives in `src/lib/` with Vitest tests; routes and pages stay thin.

**Tech Stack:** As-built M1: Next.js 16.3 (App Router, TS strict, `src/` dir, `@/*` alias), Supabase (CLI 2.113 as devDependency, migrations in `supabase/migrations/`), `@supabase/ssr` 0.12, Vitest 4. No new dependencies in this milestone.

## Global Constraints (binding for every task)

- **Nothing installed on the host.** Every npm/npx/node/psql command runs inside the dev container: from the host prefix with `./dev` (e.g. `./dev npm run test`). **Git runs on the HOST** (it owns credentials). If Git Bash mangles a path argument, prefix `MSYS_NO_PATHCONV=1`.
- **Every commit is pushed immediately** (`git push` right after `git commit`) — standing team process.
- TypeScript strict; Node 22.
- All timestamps `timestamptz` (UTC); UUID PKs via `gen_random_uuid()`.
- Roles exactly `admin`, `mentor`, `captain`, `student` (+ `guest` only as the app-level unauthenticated `Role`, never stored). Rank order (from `src/lib/authz.ts`): guest < student < captain < mentor < admin.
- **RLS enabled on every new table with ZERO policies** — service-role-only access. The absence of policies is the spec, not a gap.
- No email sending/receiving anywhere; no passwords anywhere. Storing email *addresses* is required: `person.email` is the OAuth allowlist key and **must always be stored lowercased** (this milestone adds the DB constraint and normalizes every write site).
- Server-side Supabase access always via `serverSupabaseUrl()` (`src/lib/supabase-url.ts`); never `NEXT_PUBLIC_SUPABASE_URL` in server code. The browser client (`src/lib/supabase-browser.ts`) is the sole public-URL exception.
- Secrets only in `.env.local` (git-ignored); never committed.
- **Guests get real scoped responses server-side** (Den's model): scoping happens in lib/query code, not by hiding UI.
- Guest scope (spec §8 answer 2): names on the roster, nothing else — no profiles, contact info, or attendance detail.
- db scripts: `npm run db:start | db:stop | db:reset | db:psql` (container-specific flags documented in `supabase/README.md` — do not "clean them up").
- Styling stays plain semantic HTML (no CSS frameworks in v1 milestones so far); do not add any.

**Existing interfaces you will consume (as-built, from M1):**
- `src/lib/types.ts`: `Role`, `PersonRow`, `Person`, `personFromRow(row)`.
- `src/lib/db.ts`: `getDb(): SupabaseClient` (server-only service-role client).
- `src/lib/authz.ts`: `hasRole(actual, required)`, `ForbiddenError`, `requireRole(actual, required)`.
- `src/lib/viewer.ts`: `type Viewer = { person: Person | null; role: Role }`, `getViewer(): Promise<Viewer>`.
- `src/lib/api.ts`: `withRole(required, handler, viewerSource?)` (extended in Task 2).
- `src/lib/validate.ts`, `src/lib/rate-limit.ts` — created in Task 2, used by every mutation route after it.

---

### Task 1: Schema migration (teams, memberships, applications, email normalization), seed teams, domain types

**Files:**
- Create: `supabase/migrations/<timestamp>_roster_teams.sql` (via `npx supabase migration new roster_teams`)
- Modify: `supabase/seed.sql`
- Modify: `src/lib/types.ts`
- Test: `src/lib/types.test.ts`
- Rename: `vitest.config.ts` → `vitest.config.mts` (kills the Vite CJS deprecation warning; content unchanged)

**Interfaces:**
- Consumes: existing `person` / `account_request` tables; `PersonRow`/`Person` conventions in `types.ts`.
- Produces (later tasks rely on these exact names):
  - Tables `team`, `team_membership`, `membership_application`; check constraints forcing lowercase `person.email` / `account_request.email`.
  - `type JoinMode = "admin_only" | "open" | "requires_approval"`
  - `type TeamRow = { id: string; name: string; parent_team_id: string | null; description: string | null; join_mode: JoinMode }` and `type Team = { id: string; name: string; parentTeamId: string | null; description: string | null; joinMode: JoinMode }` with `teamFromRow(row: TeamRow): Team`
  - `type ApplicationStatus = "pending" | "approved" | "denied"`
  - Extended `PersonRow`/`Person` with optional detail fields: `phone`, `shirt_size`/`shirtSize`, `dietary_restrictions`/`dietaryRestrictions`, `bio` (all `string | null`, optional on the row type so existing test fixtures stay valid).

- [ ] **Step 1: Rename the Vitest config**

```bash
git mv vitest.config.ts vitest.config.mts
./dev npm run test
```

Expected: 31 tests pass, and the "ESM syntax in a file loaded as CommonJS" warning is gone.

- [ ] **Step 2: Create the migration**

```bash
./dev npx supabase migration new roster_teams
```

Fill the generated `supabase/migrations/<timestamp>_roster_teams.sql`:

```sql
-- Teams: self-referential tree (spec §4). join_mode governs self-service joining (spec §8 answer 1).
create table team (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_team_id uuid references team (id),
  description text,
  join_mode text not null default 'admin_only'
    check (join_mode in ('admin_only', 'open', 'requires_approval')),
  created_at timestamptz not null default now()
);

create table team_membership (
  person_id uuid not null references person (id) on delete cascade,
  team_id uuid not null references team (id) on delete cascade,
  is_manager boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (person_id, team_id)
);

create table membership_application (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id) on delete cascade,
  team_id uuid not null references team (id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live application per person per team; history rows (approved/denied) may accumulate.
create unique index one_pending_application_per_person_team
  on membership_application (person_id, team_id)
  where status = 'pending';

-- M1 carry-forward: person.email is the OAuth allowlist key, matched lowercased.
-- Backfill first, then constrain so no mixed-case address can ever silently break the match.
update person set email = lower(email) where email is not null and email <> lower(email);
alter table person add constraint person_email_lowercase check (email = lower(email));

update account_request set email = lower(email) where email is not null and email <> lower(email);
alter table account_request add constraint account_request_email_lowercase check (email = lower(email));

alter table team enable row level security;
alter table team_membership enable row level security;
alter table membership_application enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).
```

- [ ] **Step 3: Extend the dev seed**

Append to `supabase/seed.sql`:

```sql
insert into team (name, description, join_mode)
values ('Red Alert Robotics', 'The whole team', 'admin_only');

insert into team (name, parent_team_id, description, join_mode)
values
  ('Programming', (select id from team where name = 'Red Alert Robotics'), 'Software subteam', 'open'),
  ('Mechanical',  (select id from team where name = 'Red Alert Robotics'), 'Mechanical subteam', 'requires_approval');
```

- [ ] **Step 4: Apply and verify**

```bash
./dev npm run db:reset
./dev npm run db:psql -- -c "select name, join_mode, (parent_team_id is null) as is_root from team order by name;"
./dev npm run db:psql -- -c "select relname, relrowsecurity from pg_class where relname in ('team','team_membership','membership_application');"
./dev npm run db:psql -- -c "select count(*) from pg_policies;"
./dev npm run db:psql -- -c "insert into person (first_name, last_name, email) values ('Bad','Case','MiXeD@Example.org');" || echo "REJECTED AS EXPECTED"
```

Expected: three teams (one root); all three new tables `relrowsecurity = t`; policy count 0; the mixed-case insert FAILS the check constraint (prints REJECTED AS EXPECTED).

- [ ] **Step 5: Write the failing type tests**

Create `src/lib/types.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { personFromRow, teamFromRow, type TeamRow } from "./types";

describe("teamFromRow", () => {
  test("maps snake_case to camelCase", () => {
    const row: TeamRow = {
      id: "t1",
      name: "Programming",
      parent_team_id: "t0",
      description: "Software",
      join_mode: "open",
    };
    expect(teamFromRow(row)).toEqual({
      id: "t1",
      name: "Programming",
      parentTeamId: "t0",
      description: "Software",
      joinMode: "open",
    });
  });
});

describe("personFromRow detail fields", () => {
  test("maps optional detail fields, defaulting to null when absent", () => {
    const person = personFromRow({
      id: "p1",
      first_name: "Test",
      last_name: "Student",
      display_name: null,
      role: "student",
      grad_year: 2028,
      email: null,
      is_active: true,
      student_id_number: "1741",
      auth_user_id: null,
    });
    expect(person.phone).toBeNull();
    expect(person.shirtSize).toBeNull();
    expect(person.dietaryRestrictions).toBeNull();
    expect(person.bio).toBeNull();
  });
});
```

Run: `./dev npm run test` → FAIL (`teamFromRow` not exported; `phone` missing on `Person`).

- [ ] **Step 6: Extend `src/lib/types.ts`**

Add to the existing file (keep everything already there; extend `PersonRow`, `Person`, and `personFromRow`, and append the team types):

```ts
// --- additions to PersonRow (optional so existing fixtures stay valid) ---
//   phone?: string | null;
//   shirt_size?: string | null;
//   dietary_restrictions?: string | null;
//   bio?: string | null;
// --- additions to Person ---
//   phone: string | null;
//   shirtSize: string | null;
//   dietaryRestrictions: string | null;
//   bio: string | null;
// --- additions inside personFromRow's returned object ---
//   phone: row.phone ?? null,
//   shirtSize: row.shirt_size ?? null,
//   dietaryRestrictions: row.dietary_restrictions ?? null,
//   bio: row.bio ?? null,

export type JoinMode = "admin_only" | "open" | "requires_approval";

export type TeamRow = {
  id: string;
  name: string;
  parent_team_id: string | null;
  description: string | null;
  join_mode: JoinMode;
};

export type Team = {
  id: string;
  name: string;
  parentTeamId: string | null;
  description: string | null;
  joinMode: JoinMode;
};

export function teamFromRow(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    parentTeamId: row.parent_team_id,
    description: row.description,
    joinMode: row.join_mode,
  };
}

export type ApplicationStatus = "pending" | "approved" | "denied";
```

(The commented lines show exactly what to merge into the existing declarations — apply them as real code edits, not comments.)

- [ ] **Step 7: Run tests, lint, typecheck**

Run: `./dev npm run test && ./dev npm run lint && ./dev npm run typecheck`
Expected: all pass (33 tests).

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "feat: add teams/memberships/applications schema, email lowercase constraint, team types"
git push
```

---

### Task 2: Validation + rate-limit libs, `withRole` context passthrough, harden the public routes

**Files:**
- Create: `src/lib/validate.ts`; Test: `src/lib/validate.test.ts`
- Create: `src/lib/rate-limit.ts`; Test: `src/lib/rate-limit.test.ts`
- Modify: `src/lib/api.ts`; Test: `src/lib/api.test.ts` (extend)
- Modify: `src/app/api/account-request/route.ts`
- Modify: `src/app/api/auth/student/route.ts`

**Interfaces:**
- Consumes: `withRole` as-built (`src/lib/api.ts`), the two public routes as-built.
- Produces:
  - `reqString(v: unknown, max: number): string | null` — trimmed required string (null = missing/invalid/too long)
  - `optString(v: unknown, max: number): { value: string | null } | null` — outer null = invalid; `value: null` = absent/blank
  - `optInt(v: unknown, min: number, max: number): { value: number | null } | null` — same convention; rejects non-integers
  - `createRateLimiter({ limit, windowMs, now? }): { check(key: string): boolean }` (fixed window, in-memory)
  - `clientIp(request: Request): string`
  - `withRole<C>(required, handler, viewerSource?)` where `handler: (viewer, request, context: C) => Promise<Response>` and the returned function is `(request: Request, context?: C) => Promise<Response>` — so `[id]` route handlers receive Next's `{ params }` context.
  - Hardened behavior: student login requires `role = 'student'` and is rate-limited; account-request validates lengths/gradYear, lowercases email, and is rate-limited.

- [ ] **Step 1: Write the failing validation tests**

Create `src/lib/validate.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { optInt, optString, reqString } from "./validate";

describe("reqString", () => {
  test("trims and accepts within max", () => {
    expect(reqString("  Ada ", 10)).toBe("Ada");
  });
  test.each([[""], ["   "], [null], [undefined], [42], ["x".repeat(11)]])(
    "rejects %j",
    (v) => expect(reqString(v, 10)).toBeNull(),
  );
});

describe("optString", () => {
  test("absent or blank becomes value:null", () => {
    expect(optString(undefined, 10)).toEqual({ value: null });
    expect(optString("   ", 10)).toEqual({ value: null });
  });
  test("valid string is trimmed", () => {
    expect(optString(" hi ", 10)).toEqual({ value: "hi" });
  });
  test("wrong type or too long is invalid (outer null)", () => {
    expect(optString(42, 10)).toBeNull();
    expect(optString("x".repeat(11), 10)).toBeNull();
  });
});

describe("optInt", () => {
  test("absent becomes value:null", () => {
    expect(optInt(undefined, 2000, 2100)).toEqual({ value: null });
  });
  test("in-range integer accepted", () => {
    expect(optInt(2028, 2000, 2100)).toEqual({ value: 2028 });
  });
  test.each([[1999], [2101], [2028.5], ["2028"], [NaN]])("rejects %j", (v) =>
    expect(optInt(v, 2000, 2100)).toBeNull(),
  );
});
```

- [ ] **Step 2: Run to verify failure, then implement `src/lib/validate.ts`**

Run: `./dev npm run test` → FAIL (module not found). Then create:

```ts
/** Required trimmed string, 1..max chars. Returns null when missing/invalid. */
export function reqString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > max) return null;
  return s;
}

/**
 * Optional trimmed string. Outer null = present but invalid (wrong type / too long).
 * { value: null } = absent or blank (treat as "not provided").
 */
export function optString(
  v: unknown,
  max: number,
): { value: string | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0) return { value: null };
  if (s.length > max) return null;
  return { value: s };
}

/** Optional integer within [min, max]. Same outer-null convention as optString. */
export function optInt(
  v: unknown,
  min: number,
  max: number,
): { value: number | null } | null {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return { value: v };
}
```

Run: `./dev npm run test` → validate suite passes.

- [ ] **Step 3: Write the failing rate-limit tests**

Create `src/lib/rate-limit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  test("allows up to limit within a window, then blocks", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  test("window reset restores allowance", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    t = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  test("keys are independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
  });
});

describe("clientIp", () => {
  test("takes the first x-forwarded-for hop", () => {
    const req = new Request("http://test/", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  test("falls back to 'unknown'", () => {
    expect(clientIp(new Request("http://test/"))).toBe("unknown");
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `src/lib/rate-limit.ts`**

```ts
/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately simple: state lives in module memory, so on serverless each
 * instance enforces independently (best-effort). For a team-sized app that is
 * an acceptable brake on abuse of the public endpoints; revisit if it isn't.
 */
type Limiter = { check(key: string): boolean };

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): Limiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { windowStart: number; count: number }>();
  return {
    check(key: string): boolean {
      const t = now();
      const entry = hits.get(key);
      if (!entry || t - entry.windowStart >= opts.windowMs) {
        hits.set(key, { windowStart: t, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= opts.limit;
    },
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// Shared instances for the public endpoints.
export const studentLoginLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
export const accountRequestLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
```

Run: `./dev npm run test` → rate-limit suite passes.

- [ ] **Step 5: Extend `withRole` with context passthrough (failing test first)**

Append to `src/lib/api.test.ts` (keep the existing tests):

```ts
test("passes route context through to the handler", async () => {
  const guarded = withRole<{ params: Promise<{ id: string }> }>(
    "admin",
    async (_viewer, _request, context) => {
      const { id } = await context.params;
      return Response.json({ id });
    },
    async () => ({
      person: {
        id: "p1", firstName: "A", lastName: "B", displayName: null,
        role: "admin", gradYear: null, email: null, isActive: true,
        studentIdNumber: null, authUserId: null,
        phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
      },
      role: "admin",
    }),
  );
  const res = await guarded(new Request("http://test/api/admin/teams/t9"), {
    params: Promise.resolve({ id: "t9" }),
  });
  expect(await res.json()).toEqual({ id: "t9" });
});
```

Run: `./dev npm run test` → FAIL (handler arity/type). Then modify `src/lib/api.ts` to:

```ts
import { ForbiddenError, requireRole } from "./authz";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

type Handler<C> = (
  viewer: Viewer,
  request: Request,
  context: C,
) => Promise<Response>;

export function withRole<C = unknown>(
  required: Role,
  handler: Handler<C>,
  viewerSource?: () => Promise<Viewer>, // injectable for tests
): (request: Request, context?: C) => Promise<Response> {
  return async (request: Request, context?: C) => {
    const getV = viewerSource ?? (await import("./viewer")).getViewer;
    const viewer = await getV();
    try {
      requireRole(viewer.role, required);
    } catch (e) {
      if (e instanceof ForbiddenError) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      throw e;
    }
    return handler(viewer, request, context as C);
  };
}
```

Run: `./dev npm run test` → PASS (all api tests, old and new).

- [ ] **Step 6: Harden the account-request route**

Replace the body of `src/app/api/account-request/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { optInt, optString, reqString } from "@/lib/validate";
import { accountRequestLimiter, clientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!accountRequestLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });

  const firstName = reqString(body.firstName, 80);
  const lastName = reqString(body.lastName, 80);
  const gradYear = optInt(body.gradYear, 2000, 2100);
  const email = optString(body.email, 254);
  if (!firstName || !lastName || !gradYear || !email) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await getDb().from("account_request").insert({
    first_name: firstName,
    last_name: lastName,
    grad_year: gradYear.value,
    // Lowercased to satisfy the account_request_email_lowercase constraint.
    email: email.value?.toLowerCase() ?? null,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Harden the student login route**

Modify `src/app/api/auth/student/route.ts`: add the imports, the rate-limit gate, the length cap, and — closing a real hole — restrict ID login to persons whose role is `student` (spec §3.3: students sign in by ID; mentors/admins use Google. Without this, an admin's ID string is a full-admin bearer token).

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createStudentSessionToken,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student-session";
import { reqString } from "@/lib/validate";
import { clientIp, studentLoginLimiter } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!studentLoginLimiter.check(clientIp(request))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    studentId?: unknown;
  } | null;
  const studentId = reqString(body?.studentId, 64);
  if (!studentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: row } = await getDb()
    .from("person")
    .select("id, is_active, role")
    .eq("student_id_number", studentId)
    // ID login is for students only (spec §3.3); staff sign in with Google.
    .eq("role", "student")
    .maybeSingle();

  if (!row || !row.is_active) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await createStudentSessionToken(
    row.id,
    process.env.STUDENT_SESSION_SECRET!,
  );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
```

- [ ] **Step 8: Full check + live verification**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Then with the stack up (`./dev npm run db:start`, seeded via `db:reset`) and `./dev npm run dev` running:

```bash
# valid student still logs in
./dev bash -lc "curl -s -X POST http://localhost:3000/api/auth/student -H 'Content-Type: application/json' -d '{\"studentId\":\"1741\"}' -o /dev/null -w '%{http_code}\n'"   # 200
# gradYear junk now 400 instead of 500
./dev bash -lc "curl -s -X POST http://localhost:3000/api/account-request -H 'Content-Type: application/json' -d '{\"firstName\":\"A\",\"lastName\":\"B\",\"gradYear\":\"soon\"}' -o /dev/null -w '%{http_code}\n'"   # 400
# rate limit trips
./dev bash -lc 'for i in $(seq 1 12); do curl -s -X POST http://localhost:3000/api/auth/student -H "Content-Type: application/json" -d "{\"studentId\":\"wrong\"}" -o /dev/null -w "%{http_code} "; done; echo'   # 401s then 429s
```

- [ ] **Step 9: Commit and push**

```bash
git add -A
git commit -m "feat: add validation and rate limiting, harden public routes, extend withRole context"
git push
```

---

### Task 3: Middleware session refresh (M1 carry-forward)

**Files:**
- Create: `src/lib/supabase-middleware.ts`
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `serverSupabaseUrl()` from `src/lib/supabase-url.ts`.
- Produces: `updateSession(request: NextRequest): Promise<NextResponse>` — refreshes an expired-but-refreshable Supabase session on any matched request, writing refreshed cookies through to both the request and response (the standard `@supabase/ssr` pattern). Fixes the M1 gap where `getViewer()`'s read-only cookie adapter could spuriously downgrade a mentor to guest.

- [ ] **Step 1: Implement `src/lib/supabase-middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveServerSupabaseUrl } from "./supabase-url";

/**
 * Refresh the Supabase auth session (if any) and write refreshed cookies
 * through to the response. getViewer()'s cookie adapter is read-only, so this
 * middleware is the only place expired-but-refreshable mentor sessions get
 * renewed server-side.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No Supabase auth cookies → nothing to refresh (students/guests skip the network hop).
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) return response;

  const supabase = createServerClient(
    resolveServerSupabaseUrl({
      SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers the refresh when the access token is expired.
  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 2: Implement `src/middleware.ts`**

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase-middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets. API routes are included on purpose:
    // withRole/getViewer read the (possibly refreshed) cookies there too.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico)$).*)",
  ],
};
```

**Next 16 note:** if `next build` reports that `middleware` has been renamed (Next 16 introduced `proxy.ts` as the successor name), rename the file to `src/proxy.ts` and the export to `proxy` per the build message, keeping the identical body — record which name the build accepted in your report.

- [ ] **Step 3: Verify**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Then with the dev server running, confirm no regressions for the non-OAuth paths (middleware must be a no-op for them):

```bash
./dev bash -lc "curl -s http://localhost:3000/api/whoami"                        # {"role":"guest","name":null}
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/" # 200
```

(Full refresh behavior is only observable with a real OAuth session — still pending Google credentials; note that in the report.)

- [ ] **Step 4: Commit and push**

```bash
git add src/middleware.ts src/lib/supabase-middleware.ts
git commit -m "feat: add middleware session refresh for Supabase auth cookies"
git push
```

---

### Task 4: People queries + role-scoped roster pages

**Files:**
- Create: `src/lib/people.ts`; Test: `src/lib/people.test.ts`
- Create: `src/app/people/page.tsx`
- Create: `src/app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `getDb`, `getViewer`, `hasRole`, `PersonRow`/`Person`/`personFromRow`, `TeamRow`/`teamFromRow`.
- Produces:
  - `type RosterView = { kind: "names"; names: string[] } | { kind: "full"; people: Person[] }`
  - `rosterView(role: Role, rows: PersonRow[]): RosterView` — PURE. mentor+ ⇒ full (active people, mapped); everyone else ⇒ alphabetized display names of active people only, no ids, no contact fields.
  - `displayName(p: { first_name: string; last_name: string; display_name: string | null }): string`
  - `listPeople(q?: string, db?: SupabaseClient): Promise<PersonRow[]>` — name search via ilike, ordered by last name.
  - `getPersonWithTeams(id: string, db?): Promise<{ person: Person; teams: { team: Team; isManager: boolean }[] } | null>`
  - `canViewProfile(viewer: Viewer, personId: string): boolean` — PURE: self or mentor+.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/people.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { canViewProfile, displayName, rosterView } from "./people";
import type { PersonRow } from "./types";
import type { Viewer } from "./viewer";

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: "p1",
  first_name: "Ada",
  last_name: "Lovelace",
  display_name: null,
  role: "student",
  grad_year: 2028,
  email: "ada@example.org",
  is_active: true,
  student_id_number: "1741",
  auth_user_id: null,
  ...over,
});

describe("rosterView", () => {
  const rows = [
    row({ id: "p1", first_name: "Ada", last_name: "Lovelace" }),
    row({ id: "p2", first_name: "Zed", last_name: "Adams", display_name: "Z" }),
    row({ id: "p3", first_name: "Gone", last_name: "Inactive", is_active: false }),
  ];

  test("guest gets alphabetized names of active people only — nothing else", () => {
    const view = rosterView("guest", rows);
    expect(view).toEqual({ kind: "names", names: ["Ada Lovelace", "Z"] });
  });

  test("student and captain also get names only", () => {
    expect(rosterView("student", rows).kind).toBe("names");
    expect(rosterView("captain", rows).kind).toBe("names");
  });

  test("mentor gets full people (active only), ordered by last name", () => {
    const view = rosterView("mentor", rows);
    expect(view.kind).toBe("full");
    if (view.kind === "full") {
      expect(view.people.map((p) => p.id)).toEqual(["p2", "p1"]); // Adams before Lovelace
      expect(view.people[1].email).toBe("ada@example.org"); // full view includes contact fields
    }
  });
});

describe("displayName", () => {
  test("prefers display_name", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: "C" })).toBe("C");
  });
  test("falls back to first + last", () => {
    expect(displayName({ first_name: "A", last_name: "B", display_name: null })).toBe("A B");
  });
});

describe("canViewProfile", () => {
  const viewerWith = (role: Viewer["role"], personId: string | null): Viewer =>
    personId
      ? {
          person: {
            id: personId, firstName: "X", lastName: "Y", displayName: null,
            role: role === "guest" ? "student" : (role as never), gradYear: null,
            email: null, isActive: true, studentIdNumber: null, authUserId: null,
            phone: null, shirtSize: null, dietaryRestrictions: null, bio: null,
          },
          role,
        }
      : { person: null, role };

  test("self can view", () => {
    expect(canViewProfile(viewerWith("student", "p1"), "p1")).toBe(true);
  });
  test("other student cannot", () => {
    expect(canViewProfile(viewerWith("student", "p2"), "p1")).toBe(false);
  });
  test("mentor can view anyone", () => {
    expect(canViewProfile(viewerWith("mentor", "p9"), "p1")).toBe(true);
  });
  test("guest cannot", () => {
    expect(canViewProfile(viewerWith("guest", null), "p1")).toBe(false);
  });
});
```

Note the sort expectations: the mentor view is ordered by last name (`Adams` before `Lovelace`); the names view is alphabetized by the rendered display name. The email assertion is the payload of the test: the full view includes contact fields, the names view carries nothing but strings.

- [ ] **Step 2: Run to verify failure, then implement `src/lib/people.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole } from "./authz";
import type { Person, PersonRow, Role, Team, TeamRow } from "./types";
import { personFromRow, teamFromRow } from "./types";
import type { Viewer } from "./viewer";

export function displayName(p: {
  first_name: string;
  last_name: string;
  display_name: string | null;
}): string {
  return p.display_name ?? `${p.first_name} ${p.last_name}`;
}

export type RosterView =
  | { kind: "names"; names: string[] }
  | { kind: "full"; people: Person[] };

/** Role-scoped roster projection (spec §8 answer 2). PURE. */
export function rosterView(role: Role, rows: PersonRow[]): RosterView {
  const active = rows.filter((r) => r.is_active);
  if (hasRole(role, "mentor")) {
    const people = [...active]
      .sort((a, b) => a.last_name.localeCompare(b.last_name))
      .map(personFromRow);
    return { kind: "full", people };
  }
  const names = active.map(displayName).sort((a, b) => a.localeCompare(b));
  return { kind: "names", names };
}

/** Self or mentor+. PURE. */
export function canViewProfile(viewer: Viewer, personId: string): boolean {
  if (viewer.person?.id === personId) return true;
  return hasRole(viewer.role, "mentor");
}

export async function listPeople(
  q?: string,
  db?: SupabaseClient,
): Promise<PersonRow[]> {
  const client = db ?? (await import("./db")).getDb();
  let query = client.from("person").select("*").order("last_name");
  if (q && q.trim()) {
    const term = q.trim().replaceAll("%", "").replaceAll(",", "");
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,display_name.ilike.%${term}%`,
    );
  }
  const { data } = await query;
  return (data ?? []) as PersonRow[];
}

export async function getPersonWithTeams(
  id: string,
  db?: SupabaseClient,
): Promise<{ person: Person; teams: { team: Team; isManager: boolean }[] } | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data: personRow } = await client
    .from("person")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!personRow) return null;

  const { data: memberships } = await client
    .from("team_membership")
    .select("is_manager, team (*)")
    .eq("person_id", id);

  const teams = (memberships ?? [])
    .filter((m) => m.team)
    .map((m) => ({
      team: teamFromRow(m.team as unknown as TeamRow),
      isManager: m.is_manager as boolean,
    }));

  return { person: personFromRow(personRow as PersonRow), teams };
}
```

Run: `./dev npm run test` → people suite passes.

- [ ] **Step 3: Roster page `src/app/people/page.tsx`**

```tsx
import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { listPeople, rosterView } from "@/lib/people";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, viewer] = await Promise.all([searchParams, getViewer()]);
  const view = rosterView(viewer.role, await listPeople(q));

  return (
    <main>
      <h1>People</h1>
      <form method="get">
        <input name="q" defaultValue={q ?? ""} placeholder="Search names" />
        <button type="submit">Search</button>
      </form>
      {view.kind === "names" ? (
        <ul>
          {view.names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Role</th><th>Grad year</th><th>Email</th><th>Active</th>
            </tr>
          </thead>
          <tbody>
            {view.people.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/people/${p.id}`}>
                    {p.displayName ?? `${p.firstName} ${p.lastName}`}
                  </Link>
                </td>
                <td>{p.role}</td>
                <td>{p.gradYear ?? ""}</td>
                <td>{p.email ?? ""}</td>
                <td>{p.isActive ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

(Note: `rosterView` filters to active people; the mentor table's Active column will therefore always read "yes" — that's fine for v1, inactive people are managed at `/admin/people`.)

- [ ] **Step 4: Profile page `src/app/people/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { canViewProfile, getPersonWithTeams } from "@/lib/people";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!canViewProfile(viewer, id)) notFound();

  const result = await getPersonWithTeams(id);
  if (!result) notFound();
  const { person, teams } = result;

  return (
    <main>
      <h1>{person.displayName ?? `${person.firstName} ${person.lastName}`}</h1>
      <dl>
        <dt>Role</dt><dd>{person.role}</dd>
        <dt>Grad year</dt><dd>{person.gradYear ?? "—"}</dd>
        <dt>Email</dt><dd>{person.email ?? "—"}</dd>
        <dt>Phone</dt><dd>{person.phone ?? "—"}</dd>
        <dt>Shirt size</dt><dd>{person.shirtSize ?? "—"}</dd>
        <dt>Dietary restrictions</dt><dd>{person.dietaryRestrictions ?? "—"}</dd>
        <dt>Bio</dt><dd>{person.bio ?? "—"}</dd>
        <dt>Active</dt><dd>{person.isActive ? "yes" : "no"}</dd>
      </dl>
      <h2>Teams</h2>
      {teams.length === 0 ? (
        <p>No team memberships.</p>
      ) : (
        <ul>
          {teams.map(({ team, isManager }) => (
            <li key={team.id}>
              {team.name}
              {isManager ? " (manager)" : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live (stack + dev server up):

```bash
./dev bash -lc "curl -s http://localhost:3000/people | grep -c 'Test Student'"          # 1 (guest sees the name)
./dev bash -lc "curl -s http://localhost:3000/people | grep -c 'Email'"                  # 0 (guest sees NO email column)
# profile as guest → 404
./dev npm run db:psql -- -c "select id from person where student_id_number = '1741';"    # note the id
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/people/<that-id>"  # 404 for guest
```

- [ ] **Step 6: Commit and push**

```bash
git add src/lib/people.ts src/lib/people.test.ts src/app/people
git commit -m "feat: add role-scoped roster and profile pages"
git push
```

---

### Task 5: Admin people CRUD (routes + pages)

**Files:**
- Modify: `src/lib/people.ts` (add `createPerson`, `updatePerson`, `parsePersonInput`); Test: extend `src/lib/people.test.ts`
- Create: `src/app/api/admin/people/route.ts`
- Create: `src/app/api/admin/people/[id]/route.ts`
- Create: `src/components/PersonForm.tsx`
- Create: `src/app/admin/people/page.tsx`
- Create: `src/app/admin/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>` (Task 2), `validate.ts`, `listPeople`/`getPersonWithTeams` (Task 4).
- Produces:
  - `type PersonInput = { firstName: string; lastName: string; displayName: string | null; role: "admin" | "mentor" | "captain" | "student"; gradYear: number | null; email: string | null; phone: string | null; shirtSize: string | null; dietaryRestrictions: string | null; bio: string | null; studentIdNumber: string | null; isActive: boolean }`
  - `parsePersonInput(body: unknown): PersonInput | null` — PURE; enforces lengths, role whitelist, gradYear range; **lowercases email**.
  - `personRowFromInput(input: PersonInput): Record<string, unknown>` — camel→snake for insert/update.
  - `createPerson(input: PersonInput, db?): Promise<{ ok: true; id: string } | { ok: false; status: number }>` (409 on unique violations — email or student ID already taken; 500 otherwise)
  - `updatePerson(id: string, input: PersonInput, db?): Promise<{ ok: boolean; status: number }>`
  - `POST /api/admin/people` (admin) → 201 `{id}` / 400 / 409; `PATCH /api/admin/people/[id]` (admin) → 200 / 400 / 404 / 409.
  - No hard delete anywhere — deactivation (`isActive: false`) is the removal story.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/people.test.ts`:

```ts
import { parsePersonInput } from "./people";

describe("parsePersonInput", () => {
  const valid = {
    firstName: "Ada",
    lastName: "Lovelace",
    role: "student",
    email: "ADA@Example.ORG",
    gradYear: 2028,
    isActive: true,
  };

  test("accepts a valid body and lowercases email", () => {
    const input = parsePersonInput(valid);
    expect(input).not.toBeNull();
    expect(input!.email).toBe("ada@example.org");
    expect(input!.role).toBe("student");
    expect(input!.displayName).toBeNull();
  });

  test.each([
    [{ ...valid, firstName: "" }],
    [{ ...valid, role: "superadmin" }],
    [{ ...valid, gradYear: 1990 }],
    [{ ...valid, email: 42 }],
    [{ ...valid, isActive: "yes" }],
    [null],
  ])("rejects %j", (body) => {
    expect(parsePersonInput(body)).toBeNull();
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement in `src/lib/people.ts`**

Append:

```ts
import { optInt, optString, reqString } from "./validate";

const ASSIGNABLE_ROLES = ["admin", "mentor", "captain", "student"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type PersonInput = {
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: AssignableRole;
  gradYear: number | null;
  email: string | null;
  phone: string | null;
  shirtSize: string | null;
  dietaryRestrictions: string | null;
  bio: string | null;
  studentIdNumber: string | null;
  isActive: boolean;
};

/** Validate + normalize an admin person payload. PURE. Null = invalid. */
export function parsePersonInput(body: unknown): PersonInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const firstName = reqString(b.firstName, 80);
  const lastName = reqString(b.lastName, 80);
  const displayName = optString(b.displayName, 80);
  const gradYear = optInt(b.gradYear, 2000, 2100);
  const email = optString(b.email, 254);
  const phone = optString(b.phone, 32);
  const shirtSize = optString(b.shirtSize, 16);
  const dietaryRestrictions = optString(b.dietaryRestrictions, 500);
  const bio = optString(b.bio, 2000);
  const studentIdNumber = optString(b.studentIdNumber, 64);
  const role = ASSIGNABLE_ROLES.find((r) => r === b.role);
  const isActive = typeof b.isActive === "boolean" ? b.isActive : null;

  if (
    !firstName || !lastName || !displayName || !gradYear || !email ||
    !phone || !shirtSize || !dietaryRestrictions || !bio ||
    !studentIdNumber || !role || isActive === null
  ) {
    return null;
  }

  return {
    firstName,
    lastName,
    displayName: displayName.value,
    role,
    gradYear: gradYear.value,
    // person.email is the OAuth allowlist key — always store lowercased.
    email: email.value?.toLowerCase() ?? null,
    phone: phone.value,
    shirtSize: shirtSize.value,
    dietaryRestrictions: dietaryRestrictions.value,
    bio: bio.value,
    studentIdNumber: studentIdNumber.value,
    isActive,
  };
}

export function personRowFromInput(input: PersonInput): Record<string, unknown> {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    display_name: input.displayName,
    role: input.role,
    grad_year: input.gradYear,
    email: input.email,
    phone: input.phone,
    shirt_size: input.shirtSize,
    dietary_restrictions: input.dietaryRestrictions,
    bio: input.bio,
    student_id_number: input.studentIdNumber,
    is_active: input.isActive,
  };
}

const UNIQUE_VIOLATION = "23505";

export async function createPerson(
  input: PersonInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("person")
    .insert(personRowFromInput(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  return { ok: true, id: data.id as string };
}

export async function updatePerson(
  id: string,
  input: PersonInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("person")
    .update(personRowFromInput(input))
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  }
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/admin/people/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createPerson, parsePersonInput } from "@/lib/people";

export const POST = withRole("admin", async (_viewer, request) => {
  const body = await request.json().catch(() => null);
  const input = parsePersonInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createPerson(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

Create `src/app/api/admin/people/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { parsePersonInput, updatePerson } from "@/lib/people";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const input = parsePersonInput(body);
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updatePerson(id, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 4: The shared form component `src/components/PersonForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PersonFormValues = {
  firstName: string; lastName: string; displayName: string; role: string;
  gradYear: string; email: string; phone: string; shirtSize: string;
  dietaryRestrictions: string; bio: string; studentIdNumber: string;
  isActive: boolean;
};

const EMPTY: PersonFormValues = {
  firstName: "", lastName: "", displayName: "", role: "student",
  gradYear: "", email: "", phone: "", shirtSize: "",
  dietaryRestrictions: "", bio: "", studentIdNumber: "", isActive: true,
};

export function PersonForm({
  initial,
  personId,
}: {
  initial?: PersonFormValues;
  personId?: string; // present = edit (PATCH), absent = create (POST)
}) {
  const [values, setValues] = useState<PersonFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  function set<K extends keyof PersonFormValues>(k: K, v: PersonFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      displayName: values.displayName || undefined,
      role: values.role,
      gradYear: values.gradYear ? Number(values.gradYear) : undefined,
      email: values.email || undefined,
      phone: values.phone || undefined,
      shirtSize: values.shirtSize || undefined,
      dietaryRestrictions: values.dietaryRestrictions || undefined,
      bio: values.bio || undefined,
      studentIdNumber: values.studentIdNumber || undefined,
      isActive: values.isActive,
    };
    const res = await fetch(
      personId ? `/api/admin/people/${personId}` : "/api/admin/people",
      {
        method: personId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) {
      setStatus("Saved.");
      router.refresh();
      if (!personId) setValues(EMPTY);
    } else if (res.status === 409) {
      setStatus("Email or student ID already in use.");
    } else {
      setStatus("Save failed — check the fields.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>First name <input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} required /></label>
      <label>Last name <input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} required /></label>
      <label>Display name <input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} /></label>
      <label>Role{" "}
        <select value={values.role} onChange={(e) => set("role", e.target.value)}>
          <option value="student">student</option>
          <option value="captain">captain</option>
          <option value="mentor">mentor</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label>Grad year <input inputMode="numeric" value={values.gradYear} onChange={(e) => set("gradYear", e.target.value)} /></label>
      <label>Email <input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} /></label>
      <label>Phone <input value={values.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Shirt size <input value={values.shirtSize} onChange={(e) => set("shirtSize", e.target.value)} /></label>
      <label>Dietary restrictions <input value={values.dietaryRestrictions} onChange={(e) => set("dietaryRestrictions", e.target.value)} /></label>
      <label>Bio <textarea value={values.bio} onChange={(e) => set("bio", e.target.value)} /></label>
      <label>Student ID <input value={values.studentIdNumber} onChange={(e) => set("studentIdNumber", e.target.value)} /></label>
      <label>Active <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} /></label>
      <button type="submit">{personId ? "Save changes" : "Create person"}</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Admin pages**

Create `src/app/admin/people/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listPeople } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";

export default async function AdminPeoplePage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const rows = await listPeople();
  return (
    <main>
      <h1>Admin — People</h1>
      <h2>Create person</h2>
      <PersonForm />
      <h2>All people ({rows.length})</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>Student ID</th><th>Email</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.display_name ?? `${r.first_name} ${r.last_name}`}</td>
              <td>{r.role}</td>
              <td>{r.student_id_number ?? ""}</td>
              <td>{r.email ?? ""}</td>
              <td>{r.is_active ? "yes" : "no"}</td>
              <td><Link href={`/admin/people/${r.id}`}>Edit</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

Create `src/app/admin/people/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getPersonWithTeams } from "@/lib/people";
import { PersonForm } from "@/components/PersonForm";

export default async function AdminEditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const result = await getPersonWithTeams(id);
  if (!result) notFound();
  const p = result.person;

  return (
    <main>
      <h1>Edit — {p.displayName ?? `${p.firstName} ${p.lastName}`}</h1>
      <PersonForm
        personId={p.id}
        initial={{
          firstName: p.firstName,
          lastName: p.lastName,
          displayName: p.displayName ?? "",
          role: p.role,
          gradYear: p.gradYear?.toString() ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
          shirtSize: p.shirtSize ?? "",
          dietaryRestrictions: p.dietaryRestrictions ?? "",
          bio: p.bio ?? "",
          studentIdNumber: p.studentIdNumber ?? "",
          isActive: p.isActive,
        }}
      />
    </main>
  );
}
```

- [ ] **Step 6: Verify**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz checks (anonymous must be denied):

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/people -H 'Content-Type: application/json' -d '{}'"   # 403
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/people"   # 307 redirect (to /login)
```

(Functional create/update is covered by the parse/create/update unit tests plus the admin UI once a real admin session exists — OAuth credentials pending. State this in the report; do not fake a session.)

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat: add admin people CRUD (routes, form, pages)"
git push
```

---

### Task 6: Teams library + admin team management

**Files:**
- Create: `src/lib/teams.ts`; Test: `src/lib/teams.test.ts`
- Create: `src/app/api/admin/teams/route.ts`
- Create: `src/app/api/admin/teams/[id]/route.ts`
- Create: `src/app/api/admin/teams/[id]/members/route.ts`
- Create: `src/components/TeamForm.tsx`
- Create: `src/components/MemberManager.tsx`
- Create: `src/app/admin/teams/page.tsx`
- Create: `src/app/admin/teams/[id]/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>`, `validate.ts`, `Team`/`TeamRow`/`teamFromRow`/`JoinMode`, `listPeople` (member picker), `displayName`.
- Produces:
  - `type TeamNode = Team & { children: TeamNode[] }`
  - `buildTeamTree(teams: Team[]): TeamNode[]` — PURE; children sorted by name; orphans (parent id not in the set) surface as roots.
  - `parseTeamInput(body: unknown): { name: string; parentTeamId: string | null; description: string | null; joinMode: JoinMode } | null` — PURE.
  - `listTeams(db?): Promise<Team[]>`; `getTeam(id, db?): Promise<Team | null>`
  - `createTeam(input, db?)` / `updateTeam(id, input, db?)` — 409 on duplicate name; update rejects `parentTeamId === id` (400).
  - `deleteTeam(id, db?): Promise<{ ok: boolean; status: number }>` — refuses (409) when the team has child teams or members.
  - `listTeamMembers(teamId, db?): Promise<{ personId: string; name: string; isManager: boolean }[]>`
  - `upsertMember(teamId, personId, isManager, db?)`, `removeMember(teamId, personId, db?)`
  - Routes: `POST /api/admin/teams` (201/400/409), `PATCH`+`DELETE /api/admin/teams/[id]`, `POST /api/admin/teams/[id]/members` `{personId, isManager}` (upsert), `DELETE /api/admin/teams/[id]/members` `{personId}` — all admin.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/teams.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildTeamTree, parseTeamInput } from "./teams";
import type { Team } from "./types";

const team = (id: string, name: string, parentTeamId: string | null): Team => ({
  id, name, parentTeamId, description: null, joinMode: "admin_only",
});

describe("buildTeamTree", () => {
  test("nests children under parents, sorted by name", () => {
    const tree = buildTeamTree([
      team("root", "Red Alert", null),
      team("m", "Mechanical", "root"),
      team("p", "Programming", "root"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.name)).toEqual(["Mechanical", "Programming"]);
  });

  test("orphaned parent ids surface as roots", () => {
    const tree = buildTeamTree([team("a", "A", "missing")]);
    expect(tree.map((t) => t.id)).toEqual(["a"]);
  });

  test("multiple roots sorted by name", () => {
    const tree = buildTeamTree([team("b", "Bravo", null), team("a", "Alpha", null)]);
    expect(tree.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("parseTeamInput", () => {
  test("accepts valid input", () => {
    expect(
      parseTeamInput({ name: " Pit Crew ", joinMode: "open" }),
    ).toEqual({ name: "Pit Crew", parentTeamId: null, description: null, joinMode: "open" });
  });
  test.each([
    [{ name: "", joinMode: "open" }],
    [{ name: "X", joinMode: "sneaky" }],
    [{ name: "X", joinMode: "open", parentTeamId: 42 }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseTeamInput(body)).toBeNull();
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/teams.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JoinMode, Team, TeamRow } from "./types";
import { teamFromRow } from "./types";
import { displayName } from "./people";
import { optString, reqString } from "./validate";

export type TeamNode = Team & { children: TeamNode[] };

/** Build the display tree. PURE. Orphans become roots; siblings sort by name. */
export function buildTeamTree(teams: Team[]): TeamNode[] {
  const nodes = new Map<string, TeamNode>(
    teams.map((t) => [t.id, { ...t, children: [] }]),
  );
  const roots: TeamNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentTeamId ? nodes.get(node.parentTeamId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: TeamNode, b: TeamNode) => a.name.localeCompare(b.name);
  const sortRec = (list: TeamNode[]) => {
    list.sort(byName);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

const JOIN_MODES: JoinMode[] = ["admin_only", "open", "requires_approval"];

export type TeamInput = {
  name: string;
  parentTeamId: string | null;
  description: string | null;
  joinMode: JoinMode;
};

/** Validate a team payload. PURE. Null = invalid. */
export function parseTeamInput(body: unknown): TeamInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const name = reqString(b.name, 80);
  const parentTeamId = optString(b.parentTeamId, 64);
  const description = optString(b.description, 500);
  const joinMode = JOIN_MODES.find((m) => m === b.joinMode);
  if (!name || !parentTeamId || !description || !joinMode) return null;
  return {
    name,
    parentTeamId: parentTeamId.value,
    description: description.value,
    joinMode,
  };
}

const UNIQUE_VIOLATION = "23505";

export async function listTeams(db?: SupabaseClient): Promise<Team[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("team").select("*").order("name");
  return ((data ?? []) as TeamRow[]).map(teamFromRow);
}

export async function getTeam(id: string, db?: SupabaseClient): Promise<Team | null> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client.from("team").select("*").eq("id", id).maybeSingle();
  return data ? teamFromRow(data as TeamRow) : null;
}

export async function createTeam(
  input: TeamInput,
  db?: SupabaseClient,
): Promise<{ ok: true; id: string } | { ok: false; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("team")
    .insert({
      name: input.name,
      parent_team_id: input.parentTeamId,
      description: input.description,
      join_mode: input.joinMode,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  return { ok: true, id: data.id as string };
}

export async function updateTeam(
  id: string,
  input: TeamInput,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  if (input.parentTeamId === id) return { ok: false, status: 400 }; // no self-parenting
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("team")
    .update({
      name: input.name,
      parent_team_id: input.parentTeamId,
      description: input.description,
      join_mode: input.joinMode,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: error.code === UNIQUE_VIOLATION ? 409 : 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Refuses to delete a team that still has children or members (409). */
export async function deleteTeam(
  id: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const [{ count: children }, { count: members }] = await Promise.all([
    client.from("team").select("id", { count: "exact", head: true }).eq("parent_team_id", id),
    client.from("team_membership").select("team_id", { count: "exact", head: true }).eq("team_id", id),
  ]);
  if ((children ?? 0) > 0 || (members ?? 0) > 0) return { ok: false, status: 409 };
  const { error } = await client.from("team").delete().eq("id", id);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function listTeamMembers(
  teamId: string,
  db?: SupabaseClient,
): Promise<{ personId: string; name: string; isManager: boolean }[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("team_membership")
    .select("is_manager, person (id, first_name, last_name, display_name)")
    .eq("team_id", teamId);
  return (data ?? [])
    .filter((m) => m.person)
    .map((m) => {
      const p = m.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      return { personId: p.id, name: displayName(p), isManager: m.is_manager as boolean };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertMember(
  teamId: string,
  personId: string,
  isManager: boolean,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("team_membership")
    .upsert(
      { team_id: teamId, person_id: personId, is_manager: isManager },
      { onConflict: "person_id,team_id" },
    );
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

export async function removeMember(
  teamId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { error } = await client
    .from("team_membership")
    .delete()
    .eq("team_id", teamId)
    .eq("person_id", personId);
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/admin/teams/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { createTeam, parseTeamInput } from "@/lib/teams";

export const POST = withRole("admin", async (_viewer, request) => {
  const input = parseTeamInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await createTeam(input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
});
```

Create `src/app/api/admin/teams/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { deleteTeam, parseTeamInput, updateTeam } from "@/lib/teams";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const input = parseTeamInput(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await updateTeam(id, input);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, _request, context) => {
  const { id } = await context.params;
  const result = await deleteTeam(id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

Create `src/app/api/admin/teams/[id]/members/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { removeMember, upsertMember } from "@/lib/teams";
import { reqString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  const isManager = typeof body?.isManager === "boolean" ? body.isManager : false;
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await upsertMember(id, personId, isManager);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});

export const DELETE = withRole<Ctx>("admin", async (_viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const personId = reqString(body?.personId, 64);
  if (!personId) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await removeMember(id, personId);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 4: Components**

Create `src/components/TeamForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TeamFormValues = {
  name: string;
  parentTeamId: string;
  description: string;
  joinMode: string;
};

export function TeamForm({
  teams,
  initial,
  teamId,
}: {
  teams: { id: string; name: string }[]; // parent options
  initial?: TeamFormValues;
  teamId?: string; // present = edit
}) {
  const EMPTY: TeamFormValues = { name: "", parentTeamId: "", description: "", joinMode: "admin_only" };
  const [values, setValues] = useState<TeamFormValues>(initial ?? EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const res = await fetch(teamId ? `/api/admin/teams/${teamId}` : "/api/admin/teams", {
      method: teamId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        parentTeamId: values.parentTeamId || undefined,
        description: values.description || undefined,
        joinMode: values.joinMode,
      }),
    });
    if (res.ok) {
      setStatus("Saved.");
      router.refresh();
      if (!teamId) setValues(EMPTY);
    } else if (res.status === 409) {
      setStatus("A team with that name already exists.");
    } else {
      setStatus("Save failed — check the fields.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>Name <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /></label>
      <label>Parent{" "}
        <select value={values.parentTeamId} onChange={(e) => setValues({ ...values, parentTeamId: e.target.value })}>
          <option value="">(none — top level)</option>
          {teams.filter((t) => t.id !== teamId).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label>Description <input value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
      <label>Join mode{" "}
        <select value={values.joinMode} onChange={(e) => setValues({ ...values, joinMode: e.target.value })}>
          <option value="admin_only">admin only</option>
          <option value="open">open</option>
          <option value="requires_approval">requires approval</option>
        </select>
      </label>
      <button type="submit">{teamId ? "Save changes" : "Create team"}</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
```

Create `src/components/MemberManager.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MemberManager({
  teamId,
  members,
  candidates,
}: {
  teamId: string;
  members: { personId: string; name: string; isManager: boolean }[];
  candidates: { id: string; name: string }[]; // people not yet on the team
}) {
  const [personId, setPersonId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(`/api/admin/teams/${teamId}/members`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      router.refresh();
      setPersonId("");
    } else {
      setStatus("Action failed.");
    }
  }

  return (
    <section>
      <h2>Members ({members.length})</h2>
      <ul>
        {members.map((m) => (
          <li key={m.personId}>
            {m.name} {m.isManager ? "(manager)" : ""}{" "}
            <button onClick={() => call("POST", { personId: m.personId, isManager: !m.isManager })}>
              {m.isManager ? "Remove manager" : "Make manager"}
            </button>{" "}
            <button onClick={() => call("DELETE", { personId: m.personId })}>Remove</button>
          </li>
        ))}
      </ul>
      <label>
        Add member{" "}
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Choose…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <button disabled={!personId} onClick={() => call("POST", { personId, isManager: false })}>
        Add
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
```

- [ ] **Step 5: Pages**

Create `src/app/admin/teams/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { buildTeamTree, listTeams, type TeamNode } from "@/lib/teams";
import { TeamForm } from "@/components/TeamForm";

function Tree({ nodes }: { nodes: TeamNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/admin/teams/${n.id}`}>{n.name}</Link> — {n.joinMode}
          <Tree nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

export default async function AdminTeamsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const teams = await listTeams();
  return (
    <main>
      <h1>Admin — Teams</h1>
      <h2>Create team</h2>
      <TeamForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      <h2>Team tree</h2>
      <Tree nodes={buildTeamTree(teams)} />
    </main>
  );
}
```

Create `src/app/admin/teams/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { getTeam, listTeamMembers, listTeams } from "@/lib/teams";
import { listPeople, displayName } from "@/lib/people";
import { TeamForm } from "@/components/TeamForm";
import { MemberManager } from "@/components/MemberManager";
import { DeleteTeamButton } from "@/components/DeleteTeamButton";

export default async function AdminTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const [team, teams, members, everyone] = await Promise.all([
    getTeam(id),
    listTeams(),
    listTeamMembers(id),
    listPeople(),
  ]);
  if (!team) notFound();

  const memberIds = new Set(members.map((m) => m.personId));
  const candidates = everyone
    .filter((p) => p.is_active && !memberIds.has(p.id))
    .map((p) => ({ id: p.id, name: displayName(p) }));

  return (
    <main>
      <h1>Team — {team.name}</h1>
      <TeamForm
        teamId={team.id}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        initial={{
          name: team.name,
          parentTeamId: team.parentTeamId ?? "",
          description: team.description ?? "",
          joinMode: team.joinMode,
        }}
      />
      <MemberManager teamId={team.id} members={members} candidates={candidates} />
      <DeleteTeamButton teamId={team.id} />
    </main>
  );
}
```

Create `src/components/DeleteTeamButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteTeamButton({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function remove() {
    if (!confirm("Delete this team? Only possible when it has no sub-teams or members.")) return;
    const res = await fetch(`/api/admin/teams/${teamId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/admin/teams");
      router.refresh();
    } else if (res.status === 409) {
      setStatus("Team still has sub-teams or members — remove them first.");
    } else {
      setStatus("Delete failed.");
    }
  }

  return (
    <p>
      <button onClick={remove}>Delete team</button>
      {status && <span role="status"> {status}</span>}
    </p>
  );
}
```

(Also add `Create: src/components/DeleteTeamButton.tsx` to this task's file list — it is part of Step 5.)

- [ ] **Step 6: Verify**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/teams -H 'Content-Type: application/json' -d '{\"name\":\"X\",\"joinMode\":\"open\"}'"   # 403 anonymous
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/teams"    # 307
```

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat: add teams library and admin team management"
git push
```

---

### Task 7: Member-facing teams page with join/apply

**Files:**
- Modify: `src/lib/teams.ts` (add `joinAction`, `applyToTeam`, `joinTeam`, `pendingApplicationTeamIds`); Test: extend `src/lib/teams.test.ts`
- Create: `src/app/api/teams/[id]/join/route.ts`
- Create: `src/app/api/teams/[id]/apply/route.ts`
- Create: `src/components/JoinButtons.tsx`
- Create: `src/app/teams/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>`, `getViewer`, teams lib (Task 6), unique pending-application index (Task 1).
- Produces:
  - `type JoinActionResult = "member" | "join" | "apply" | "pending" | "none"`
  - `joinAction(team: Team, isMember: boolean, hasPendingApplication: boolean): JoinActionResult` — PURE: member ⇒ "member"; open ⇒ "join"; requires_approval ⇒ "pending" if an application is pending else "apply"; admin_only ⇒ "none".
  - `joinTeam(teamId, personId, db?): Promise<{ ok: boolean; status: number }>` — verifies the team is `open` server-side (403 otherwise).
  - `applyToTeam(teamId, personId, message: string | null, db?): Promise<{ ok: boolean; status: number }>` — verifies `requires_approval`; 409 when a pending application already exists (unique index).
  - `POST /api/teams/[id]/join` and `POST /api/teams/[id]/apply` — require `student` role or above AND a linked person.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/teams.test.ts`:

```ts
import { joinAction } from "./teams";

describe("joinAction", () => {
  const t = (joinMode: Team["joinMode"]): Team => ({
    id: "t1", name: "T", parentTeamId: null, description: null, joinMode,
  });

  test("existing member", () => {
    expect(joinAction(t("open"), true, false)).toBe("member");
  });
  test("open team is joinable", () => {
    expect(joinAction(t("open"), false, false)).toBe("join");
  });
  test("approval team without pending app is applyable", () => {
    expect(joinAction(t("requires_approval"), false, false)).toBe("apply");
  });
  test("approval team with pending app shows pending", () => {
    expect(joinAction(t("requires_approval"), false, true)).toBe("pending");
  });
  test("admin_only offers nothing", () => {
    expect(joinAction(t("admin_only"), false, false)).toBe("none");
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement in `src/lib/teams.ts`**

Append:

```ts
export type JoinActionResult = "member" | "join" | "apply" | "pending" | "none";

/** What the teams page offers this person for this team. PURE. */
export function joinAction(
  team: Team,
  isMember: boolean,
  hasPendingApplication: boolean,
): JoinActionResult {
  if (isMember) return "member";
  if (team.joinMode === "open") return "join";
  if (team.joinMode === "requires_approval") {
    return hasPendingApplication ? "pending" : "apply";
  }
  return "none";
}

export async function memberTeamIds(
  personId: string,
  db?: SupabaseClient,
): Promise<Set<string>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("team_membership")
    .select("team_id")
    .eq("person_id", personId);
  return new Set((data ?? []).map((r) => r.team_id as string));
}

export async function pendingApplicationTeamIds(
  personId: string,
  db?: SupabaseClient,
): Promise<Set<string>> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("membership_application")
    .select("team_id")
    .eq("person_id", personId)
    .eq("status", "pending");
  return new Set((data ?? []).map((r) => r.team_id as string));
}

/** Self-service join — server-side re-check that the team really is open. */
export async function joinTeam(
  teamId: string,
  personId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const team = await getTeam(teamId, client);
  if (!team) return { ok: false, status: 404 };
  if (team.joinMode !== "open") return { ok: false, status: 403 };
  const { error } = await client
    .from("team_membership")
    .upsert(
      { team_id: teamId, person_id: personId, is_manager: false },
      { onConflict: "person_id,team_id" },
    );
  if (error) return { ok: false, status: 500 };
  return { ok: true, status: 200 };
}

const UNIQUE_VIOLATION_APPLY = "23505";

/** Self-service application — one pending application per (person, team). */
export async function applyToTeam(
  teamId: string,
  personId: string,
  message: string | null,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const team = await getTeam(teamId, client);
  if (!team) return { ok: false, status: 404 };
  if (team.joinMode !== "requires_approval") return { ok: false, status: 403 };
  const { error } = await client.from("membership_application").insert({
    team_id: teamId,
    person_id: personId,
    message,
  });
  if (error) {
    return { ok: false, status: error.code === UNIQUE_VIOLATION_APPLY ? 409 : 500 };
  }
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/teams/[id]/join/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { joinTeam } from "@/lib/teams";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("student", async (viewer, _request, context) => {
  if (!viewer.person) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const result = await joinTeam(id, viewer.person.id);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

Create `src/app/api/teams/[id]/apply/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { applyToTeam } from "@/lib/teams";
import { optString } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("student", async (viewer, request, context) => {
  if (!viewer.person) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = optString(body?.message, 500);
  if (!message) return Response.json({ error: "invalid" }, { status: 400 });
  const result = await applyToTeam(id, viewer.person.id, message.value);
  if (!result.ok) return Response.json({ error: "failed" }, { status: result.status });
  return Response.json({ ok: true });
});
```

- [ ] **Step 4: Component + page**

Create `src/components/JoinButtons.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JoinActionResult } from "@/lib/teams";

export function JoinButtons({
  teamId,
  action,
}: {
  teamId: string;
  action: JoinActionResult;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function post(path: string, body?: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) router.refresh();
    else if (res.status === 409) setStatus("You already have a pending application.");
    else setStatus("Action failed.");
  }

  if (action === "member") return <em>member</em>;
  if (action === "pending") return <em>application pending</em>;
  if (action === "join") {
    return (
      <>
        <button onClick={() => post(`/api/teams/${teamId}/join`)}>Join</button>
        {status && <span role="status"> {status}</span>}
      </>
    );
  }
  if (action === "apply") {
    return (
      <>
        <input
          placeholder="Message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button onClick={() => post(`/api/teams/${teamId}/apply`, { message: message || undefined })}>
          Apply
        </button>
        {status && <span role="status"> {status}</span>}
      </>
    );
  }
  return null;
}
```

Create `src/app/teams/page.tsx`:

```tsx
import { getViewer } from "@/lib/viewer";
import {
  buildTeamTree,
  joinAction,
  listTeams,
  memberTeamIds,
  pendingApplicationTeamIds,
  type TeamNode,
} from "@/lib/teams";
import { JoinButtons } from "@/components/JoinButtons";

export default async function TeamsPage() {
  const viewer = await getViewer();
  const teams = await listTeams();
  const [memberIds, pendingIds] = viewer.person
    ? await Promise.all([
        memberTeamIds(viewer.person.id),
        pendingApplicationTeamIds(viewer.person.id),
      ])
    : [new Set<string>(), new Set<string>()];

  function Tree({ nodes }: { nodes: TeamNode[] }) {
    if (nodes.length === 0) return null;
    return (
      <ul>
        {nodes.map((n) => (
          <li key={n.id}>
            <strong>{n.name}</strong>
            {n.description ? ` — ${n.description}` : ""}{" "}
            {viewer.person && (
              <JoinButtons
                teamId={n.id}
                action={joinAction(n, memberIds.has(n.id), pendingIds.has(n.id))}
              />
            )}
            <Tree nodes={n.children} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main>
      <h1>Teams</h1>
      {!viewer.person && <p>Sign in to join a team.</p>}
      <Tree nodes={buildTeamTree(teams)} />
    </main>
  );
}
```

- [ ] **Step 5: Verify — including a real join/apply round-trip via the seeded student**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live (stack + dev server up, `db:reset` applied so the `1741` student + seed teams exist):

```bash
# login as the seeded student, capture cookie
./dev bash -lc "curl -s -c /tmp/jar -X POST http://localhost:3000/api/auth/student -H 'Content-Type: application/json' -d '{\"studentId\":\"1741\"}' -o /dev/null -w '%{http_code}\n'"   # 200
# join the open Programming team
./dev bash -lc "PROG=\$(curl -s http://localhost:3000/api/whoami >/dev/null; echo); true"
./dev npm run db:psql -- -c "select id from team where name = 'Programming';"   # note <prog-id>
./dev bash -lc "curl -s -b /tmp/jar -X POST http://localhost:3000/api/teams/<prog-id>/join -o /dev/null -w '%{http_code}\n'"   # 200
./dev npm run db:psql -- -c "select t.name, m.is_manager from team_membership m join team t on t.id = m.team_id;"   # Programming row exists
# apply to Mechanical (requires_approval), twice — second gets 409
./dev npm run db:psql -- -c "select id from team where name = 'Mechanical';"    # note <mech-id>
./dev bash -lc "curl -s -b /tmp/jar -X POST http://localhost:3000/api/teams/<mech-id>/apply -H 'Content-Type: application/json' -d '{\"message\":\"please\"}' -o /dev/null -w '%{http_code}\n'"   # 200
./dev bash -lc "curl -s -b /tmp/jar -X POST http://localhost:3000/api/teams/<mech-id>/apply -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}\n'"   # 409
# joining an admin_only team is refused
./dev npm run db:psql -- -c "select id from team where name = 'Red Alert Robotics';"   # note <root-id>
./dev bash -lc "curl -s -b /tmp/jar -X POST http://localhost:3000/api/teams/<root-id>/join -o /dev/null -w '%{http_code}\n'"   # 403
# anonymous is refused entirely
./dev bash -lc "curl -s -X POST http://localhost:3000/api/teams/<prog-id>/join -o /dev/null -w '%{http_code}\n'"   # 403
```

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat: add member teams page with join and apply flows"
git push
```

---

### Task 8: Review queues — account requests and membership applications

**Files:**
- Create: `src/lib/requests.ts`; Test: `src/lib/requests.test.ts`
- Create: `src/app/api/admin/requests/account/[id]/route.ts`
- Create: `src/app/api/admin/requests/application/[id]/route.ts`
- Create: `src/components/RequestActions.tsx`
- Create: `src/app/admin/requests/page.tsx`

**Interfaces:**
- Consumes: `withRole<C>`, `validate.ts`, `createPerson`/`PersonInput` (Task 5), `upsertMember` (Task 6).
- Produces:
  - `type AccountRequestRow = { id: string; first_name: string; last_name: string; grad_year: number | null; email: string | null; status: string; created_at: string }`
  - `parseApproval(body: unknown): { studentIdNumber: string; role: "student" | "captain" } | null` — PURE; student ID required (spec §3.4: approving assigns the ID), role limited to the two student-side roles (mentors/admins are created via `/admin/people`, not the request queue).
  - `listPendingAccountRequests(db?)`, `listPendingApplications(db?)` (joined with person + team names)
  - `approveAccountRequest(id, approval, reviewerId, db?): Promise<{ ok: boolean; status: number }>` — creates the person (email lowercased via `PersonInput` path), then marks the request approved; 404 unknown/not-pending; 409 student-ID/email conflict.
  - `denyAccountRequest(id, reviewerId, db?)`; `approveApplication(id, reviewerId, db?)` (inserts membership then marks approved); `denyApplication(id, reviewerId, db?)`.
  - Routes: `POST /api/admin/requests/account/[id]` body `{action:"approve", studentIdNumber, role?}` or `{action:"deny"}`; `POST /api/admin/requests/application/[id]` body `{action:"approve"|"deny"}` — admin only.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/requests.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseApproval } from "./requests";

describe("parseApproval", () => {
  test("accepts student ID with default role student", () => {
    expect(parseApproval({ studentIdNumber: " 1742 " })).toEqual({
      studentIdNumber: "1742",
      role: "student",
    });
  });
  test("accepts captain", () => {
    expect(parseApproval({ studentIdNumber: "17", role: "captain" })).toEqual({
      studentIdNumber: "17",
      role: "captain",
    });
  });
  test.each([
    [{}],
    [{ studentIdNumber: "" }],
    [{ studentIdNumber: "ok", role: "admin" }],
    [{ studentIdNumber: "x".repeat(65) }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseApproval(body)).toBeNull();
  });
});
```

Run: `./dev npm run test` → FAIL.

- [ ] **Step 2: Implement `src/lib/requests.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPerson } from "./people";
import { upsertMember } from "./teams";
import { reqString } from "./validate";

export type AccountRequestRow = {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  email: string | null;
  status: string;
  created_at: string;
};

export type PendingApplication = {
  id: string;
  personName: string;
  teamId: string;
  teamName: string;
  personId: string;
  message: string | null;
  createdAt: string;
};

const APPROVABLE_ROLES = ["student", "captain"] as const;

/** Validate the approval payload. PURE. Mentors/admins are created in /admin/people, not here. */
export function parseApproval(
  body: unknown,
): { studentIdNumber: string; role: (typeof APPROVABLE_ROLES)[number] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const studentIdNumber = reqString(b.studentIdNumber, 64);
  if (!studentIdNumber) return null;
  const role =
    b.role === undefined
      ? "student"
      : APPROVABLE_ROLES.find((r) => r === b.role);
  if (!role) return null;
  return { studentIdNumber, role };
}

export async function listPendingAccountRequests(
  db?: SupabaseClient,
): Promise<AccountRequestRow[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("account_request")
    .select("*")
    .eq("status", "pending")
    .order("created_at");
  return (data ?? []) as AccountRequestRow[];
}

export async function listPendingApplications(
  db?: SupabaseClient,
): Promise<PendingApplication[]> {
  const client = db ?? (await import("./db")).getDb();
  const { data } = await client
    .from("membership_application")
    .select(
      "id, message, created_at, person (id, first_name, last_name, display_name), team (id, name)",
    )
    .eq("status", "pending")
    .order("created_at");
  return (data ?? [])
    .filter((r) => r.person && r.team)
    .map((r) => {
      const p = r.person as unknown as {
        id: string; first_name: string; last_name: string; display_name: string | null;
      };
      const t = r.team as unknown as { id: string; name: string };
      return {
        id: r.id as string,
        personId: p.id,
        personName: p.display_name ?? `${p.first_name} ${p.last_name}`,
        teamId: t.id,
        teamName: t.name,
        message: (r.message as string | null) ?? null,
        createdAt: r.created_at as string,
      };
    });
}

/**
 * Approve: create the person from the request, then mark the request reviewed.
 * Not transactional (PostgREST has no multi-statement tx): if the second step
 * fails, the person exists but the request stays pending — re-approving then
 * 409s on the duplicate student ID, which surfaces the inconsistency rather
 * than hiding it. Acceptable at team scale.
 */
export async function approveAccountRequest(
  id: string,
  approval: { studentIdNumber: string; role: "student" | "captain" },
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: request } = await client
    .from("account_request")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return { ok: false, status: 404 };
  const r = request as AccountRequestRow;

  const created = await createPerson(
    {
      firstName: r.first_name,
      lastName: r.last_name,
      displayName: null,
      role: approval.role,
      gradYear: r.grad_year,
      email: r.email, // already lowercased by the request route + DB constraint
      phone: null,
      shirtSize: null,
      dietaryRestrictions: null,
      bio: null,
      studentIdNumber: approval.studentIdNumber,
      isActive: true,
    },
    client,
  );
  if (!created.ok) return { ok: false, status: created.status };

  const { error } = await client
    .from("account_request")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("account_request approved but status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

export async function denyAccountRequest(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("account_request")
    .update({ status: "denied", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}

/** Approve an application: create the membership, then mark reviewed. */
export async function approveApplication(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data: app } = await client
    .from("membership_application")
    .select("id, person_id, team_id")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!app) return { ok: false, status: 404 };

  const membership = await upsertMember(
    app.team_id as string,
    app.person_id as string,
    false,
    client,
  );
  if (!membership.ok) return { ok: false, status: membership.status };

  const { error } = await client
    .from("membership_application")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("application approved but status update failed", { id, error });
    return { ok: false, status: 500 };
  }
  return { ok: true, status: 200 };
}

export async function denyApplication(
  id: string,
  reviewerId: string,
  db?: SupabaseClient,
): Promise<{ ok: boolean; status: number }> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("membership_application")
    .update({ status: "denied", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, status: 200 };
}
```

Run: `./dev npm run test` → PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/admin/requests/account/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import {
  approveAccountRequest,
  denyAccountRequest,
  parseApproval,
} from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const reviewerId = viewer.person!.id;

  if (body?.action === "deny") {
    const result = await denyAccountRequest(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  if (body?.action === "approve") {
    const approval = parseApproval(body);
    if (!approval) return Response.json({ error: "invalid" }, { status: 400 });
    const result = await approveAccountRequest(id, approval, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  return Response.json({ error: "invalid" }, { status: 400 });
});
```

Create `src/app/api/admin/requests/application/[id]/route.ts`:

```ts
import { withRole } from "@/lib/api";
import { approveApplication, denyApplication } from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRole<Ctx>("admin", async (viewer, request, context) => {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const reviewerId = viewer.person!.id;

  if (body?.action === "approve") {
    const result = await approveApplication(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  if (body?.action === "deny") {
    const result = await denyApplication(id, reviewerId);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: "failed" }, { status: result.status });
  }
  return Response.json({ error: "invalid" }, { status: 400 });
});
```

(Note: `viewer.person!` is safe here — an `admin` viewer always has a linked person; `withRole("admin", ...)` cannot pass a guest.)

- [ ] **Step 4: Component + page**

Create `src/components/RequestActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountRequestActions({ requestId }: { requestId: string }) {
  const [studentId, setStudentId] = useState("");
  const [role, setRole] = useState("student");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function act(body: Record<string, unknown>) {
    setStatus(null);
    const res = await fetch(`/api/admin/requests/account/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) router.refresh();
    else if (res.status === 409) setStatus("Student ID or email already in use.");
    else setStatus("Action failed.");
  }

  return (
    <span>
      <input
        placeholder="Assign student ID"
        value={studentId}
        onChange={(e) => setStudentId(e.target.value)}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="student">student</option>
        <option value="captain">captain</option>
      </select>
      <button
        disabled={!studentId.trim()}
        onClick={() => act({ action: "approve", studentIdNumber: studentId, role })}
      >
        Approve
      </button>
      <button onClick={() => act({ action: "deny" })}>Deny</button>
      {status && <span role="status"> {status}</span>}
    </span>
  );
}

export function ApplicationActions({ applicationId }: { applicationId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function act(action: "approve" | "deny") {
    setStatus(null);
    const res = await fetch(`/api/admin/requests/application/${applicationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) router.refresh();
    else setStatus("Action failed.");
  }

  return (
    <span>
      <button onClick={() => act("approve")}>Approve</button>
      <button onClick={() => act("deny")}>Deny</button>
      {status && <span role="status"> {status}</span>}
    </span>
  );
}
```

Create `src/app/admin/requests/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import {
  listPendingAccountRequests,
  listPendingApplications,
} from "@/lib/requests";
import {
  AccountRequestActions,
  ApplicationActions,
} from "@/components/RequestActions";

export default async function AdminRequestsPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");

  const [accountRequests, applications] = await Promise.all([
    listPendingAccountRequests(),
    listPendingApplications(),
  ]);

  return (
    <main>
      <h1>Admin — Requests</h1>

      <h2>Account requests ({accountRequests.length})</h2>
      {accountRequests.length === 0 ? (
        <p>None pending.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Grad year</th><th>Email</th><th>Requested</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {accountRequests.map((r) => (
              <tr key={r.id}>
                <td>{r.first_name} {r.last_name}</td>
                <td>{r.grad_year ?? ""}</td>
                <td>{r.email ?? ""}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td><AccountRequestActions requestId={r.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Membership applications ({applications.length})</h2>
      {applications.length === 0 ? (
        <p>None pending.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Person</th><th>Team</th><th>Message</th><th>Applied</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{a.personName}</td>
                <td>{a.teamName}</td>
                <td>{a.message ?? ""}</td>
                <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                <td><ApplicationActions applicationId={a.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live authz + the anonymous account-request feed the queue reads:

```bash
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/requests/account/00000000-0000-0000-0000-000000000000 -H 'Content-Type: application/json' -d '{\"action\":\"deny\"}'"   # 403 anonymous
./dev bash -lc "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/requests"   # 307
# functional lib check without a browser admin session: exercise approve via psql inspection
./dev bash -lc "curl -s -X POST http://localhost:3000/api/account-request -H 'Content-Type: application/json' -d '{\"firstName\":\"Queue\",\"lastName\":\"Check\",\"email\":\"Q@X.ORG\"}' -o /dev/null -w '%{http_code}\n'"   # 200
./dev npm run db:psql -- -c "select first_name, email, status from account_request where last_name = 'Check';"   # email stored lowercase 'q@x.org', status pending
```

(Full approve/deny click-through needs an admin session — pending Google credentials; the approve path's logic is covered by `parseApproval` tests + `createPerson` tests + the seeded-flow M3 work. State this in the report.)

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat: add admin review queues for account requests and applications"
git push
```

---

### Task 9: Site navigation, home page links, docs

**Files:**
- Create: `src/components/SiteNav.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getViewer`, `hasRole`.
- Produces: a role-aware nav rendered on every page; home page links to the new sections.

- [ ] **Step 1: Nav component `src/components/SiteNav.tsx`** (server component — no directive)

```tsx
import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";

export async function SiteNav() {
  const viewer = await getViewer();
  return (
    <nav>
      <Link href="/">Home</Link> <Link href="/people">People</Link>{" "}
      <Link href="/teams">Teams</Link>{" "}
      {hasRole(viewer.role, "admin") && (
        <>
          <Link href="/admin/people">Admin: People</Link>{" "}
          <Link href="/admin/teams">Admin: Teams</Link>{" "}
          <Link href="/admin/requests">Admin: Requests</Link>{" "}
        </>
      )}
      {viewer.person ? (
        <span>
          {viewer.person.displayName ?? viewer.person.firstName} ({viewer.role})
        </span>
      ) : (
        <Link href="/login">Sign in</Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Wire into `src/app/layout.tsx`**

Add `import { SiteNav } from "@/components/SiteNav";` and render `<SiteNav />` as the first child inside `<body>`, before `{children}`. Keep fonts/metadata untouched.

- [ ] **Step 3: Home page links**

In `src/app/page.tsx`, inside the signed-in branch, add below the sign-out form:

```tsx
<ul>
  <li><Link href="/people">People</Link></li>
  <li><Link href="/teams">Teams</Link></li>
</ul>
```

(`Link` is already imported in that file.)

- [ ] **Step 4: README**

In `README.md`, under the Development section, add a short "What's built so far" list: login (student ID + mentor Google), role-scoped roster (`/people`), profiles, teams with join/apply (`/teams`), admin pages (`/admin/people`, `/admin/teams`, `/admin/requests`).

- [ ] **Step 5: Full verification sweep**

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build
```

Live: `./dev bash -lc "curl -s http://localhost:3000/ | grep -oE 'People|Teams|Sign in' | sort -u"` → all three appear for a guest; `curl -s http://localhost:3000/ | grep -c 'Admin:'` → 0 for a guest.

After pushing, confirm CI: on the HOST run `gh run watch --exit-status` (or `gh run list --limit 1`).

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat: add role-aware site navigation and home links"
git push
```

---

## Self-review notes

- **Spec coverage (M2 slice):** §4 tables `team`/`team_membership`/`membership_application` ✓ (T1); email-lowercase carry-forward ✓ (T1 constraint + T2/T5/T8 write sites); input hardening + rate limiting carry-forward ✓ (T2); middleware carry-forward ✓ (T3); `/people` + `/people/[id]` with guest scoping ✓ (T4); `/admin/people` CRUD incl. role + student-ID assignment ✓ (T5); team tree + join modes + memberships ✓ (T6); self-service join/apply ✓ (T7); `/admin/requests` both queues ✓ (T8); role-aware nav ✓ (T9).
- **Deliberately out of M2:** profile session/attendance tabs (M3/M4 data), `/me/attendance`, kiosk, periods, `/admin/periods`, `/admin/settings` (its settings arrive with M3/M4 features), any hard-delete of people (deactivation instead).
- **Known limitation stated in code:** approve flows are two sequential writes, not a transaction — failure mode documented in `requests.ts` and surfaced by the 409-on-retry behavior.
- **Admin-session verification gap:** admin mutations can't be curl-verified end-to-end until Google OAuth credentials exist; per-task steps verify 403-for-anonymous + unit-test the logic, and the student-session flows (join/apply) ARE verified end-to-end via the seeded student. This is the same posture M1 shipped with.
- **Type consistency check:** `withRole<C>` context generic (T2) matches every `[id]` route usage (T5–T8); `PersonInput`/`parsePersonInput` (T5) is what `approveAccountRequest` builds (T8); `upsertMember` (T6) is what `approveApplication` calls (T8); `JoinActionResult` (T7) is what `JoinButtons` consumes; `displayName` (T4) used by teams lib (T6). Fixed inline: the roster test's accidental tautological email assertion is called out in T4 Step 1 with the correct assertion to write.

# Milestone 1: Foundation & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed-locally Next.js + Supabase app where mentors sign in with Google (allowlisted, first user becomes admin), students sign in with an arbitrary-string ID, and every request resolves to a `{ person, role }` viewer with server-enforced role checks — the base every later milestone builds on.

**Architecture:** Next.js App Router (TypeScript) with all data access through server code using the Supabase service-role client; RLS enabled default-deny with zero policies. Two session types — Supabase Auth cookies (mentor OAuth) and an app-signed JWT cookie (students) — normalized by one `getViewer()` helper. Pure logic (tokens, role ranks, bootstrap decision) lives in `src/lib/` with Vitest unit tests; route handlers stay thin.

**Tech Stack:** Next.js 15 (App Router, TS strict), Supabase (Postgres 15+, Auth, CLI migrations), `@supabase/supabase-js` + `@supabase/ssr`, `jose` (student JWT), Vitest, GitHub Actions. **All local development runs in a VS Code Dev Container** — the only host requirements are Docker Desktop, VS Code, and a browser.

## Global Constraints (from the spec)

- **Nothing is installed on the host.** No Node, no npm, no Supabase CLI, no psql on the host machine. The Supabase CLI is an npm devDependency invoked as `npx supabase`, never a host binary.
- **Every command below runs inside the dev container.** Task 0 builds it and provides `./dev`. From the host, prefix commands with `./dev` (`./dev npm test`); inside a VS Code container terminal, run them bare (`npm test`). Where later tasks write `npm run …`, `npx …`, or `psql …`, that means *inside the container* — via `./dev` when driving from the host. **Git commands are the exception: run `git` on the host** (it owns the credentials and remote access).
- TypeScript strict; Node 22 (provided by the container image).
- All timestamps `timestamptz` (UTC); UUID PKs (`gen_random_uuid()`).
- Roles enum exactly: `admin`, `mentor`, `captain`, `student` (guest = unauthenticated, never stored).
- `person.student_id_number` is an **arbitrary unique string** (phone, school ID, anything).
- RLS enabled on every table, **zero policies** — service-key-only access. Never use the anon key for data.
- No email *sending or receiving* anywhere, and no passwords anywhere (spec §1). Note this is about email as a communication channel/feature — storing an email *address* is fine and required: `person.email` backs the mentor OAuth allowlist (spec §3.2) and `account_request.email` is the optional contact field on the request form (spec §3.4). Both appear in the approved spec data model (§4).
- Team timezone lives in `app_setting` key `team_timezone`, default `"America/Indiana/Indianapolis"`.
- Every commit is pushed to `origin master` immediately (standing team process).
- Secrets only in `.env.local` (gitignored) / Vercel env vars — never committed.
- **Two Supabase URLs, always.** Inside the container, the Supabase stack is a *sibling* container set reachable at `host.docker.internal`, not `localhost`. So: server-side code uses `SUPABASE_INTERNAL_URL` (`http://host.docker.internal:54321`); browser code uses `NEXT_PUBLIC_SUPABASE_URL` (`http://127.0.0.1:54321`, which is what the host browser can reach). Every server-side Supabase client goes through `serverSupabaseUrl()` (Task 3) — never read `NEXT_PUBLIC_SUPABASE_URL` in server code.

---

### Task 0: Containerized dev environment (Dev Container)

**Files:**
- Create: `.devcontainer/Dockerfile`
- Create: `.devcontainer/docker-compose.yml`
- Create: `.devcontainer/devcontainer.json`
- Create: `dev` (executable helper script at repo root)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: one container definition usable two ways — VS Code "Reopen in Container", and headless `./dev <command>` from the host. Both give Node 22, `npx`, `psql`, and a `docker` CLI wired to the host daemon. Every later task runs its commands through one of these two paths.

Design (validated against the known devcontainer + Supabase pitfalls):
- **Compose-based devcontainer** (`dockerComposeFile` + `service` + `workspaceFolder`) rather than an image/Dockerfile-only devcontainer. This matters because it gives *one* environment definition that both VS Code and plain `docker compose` can start — no drift between "what the human opens" and "what automation runs".
- **docker-outside-of-docker**: the container mounts the host Docker socket, so `npx supabase start` launches *sibling* containers on the host daemon. Their ports (54321 API, 54322 Postgres, 54323 Studio) publish on the host, so the host browser reaches them at `127.0.0.1` while the dev container reaches them at `host.docker.internal`.
- `LOCAL_WORKSPACE_FOLDER` carries the *host* path of the repo. Sibling containers can only bind-mount host paths; M1 doesn't need it, but omitting it produces cryptic path errors once Edge Functions or `db test` appear.

- [ ] **Step 1: Write the container image**

Create `.devcontainer/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# postgresql-client: inspect the local Supabase database from inside the container.
# docker.io: CLI only — it talks to the host daemon via the mounted socket.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client docker.io \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Write the compose file**

Create `.devcontainer/docker-compose.yml`:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - ../:/workspaces/hub:cached
      # Host Docker socket: lets the Supabase CLI start sibling containers.
      - /var/run/docker.sock:/var/run/docker.sock
    working_dir: /workspaces/hub
    environment:
      # Host path of the repo, for tooling that bind-mounts into sibling containers.
      LOCAL_WORKSPACE_FOLDER: ${LOCAL_WORKSPACE_FOLDER:-}
    extra_hosts:
      # Provided automatically by Docker Desktop; declared for Linux hosts too.
      - "host.docker.internal:host-gateway"
    ports:
      - "3000:3000"
    # Keep the container alive so VS Code (and `docker compose exec`) can attach.
    command: sleep infinity
```

- [ ] **Step 3: Write the dev container config**

Create `.devcontainer/devcontainer.json`:

```jsonc
{
  "name": "team-hub",
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspaces/hub",
  "forwardPorts": [3000],
  "portsAttributes": {
    "3000": { "label": "Next.js dev server", "onAutoForward": "notify" }
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "terminal.integrated.defaultProfile.linux": "bash"
      }
    }
  },
  "remoteUser": "node"
}
```

- [ ] **Step 4: Write the headless helper**

Create `dev` at the repo root (make it executable: `git update-index --chmod=+x dev` after adding, or `chmod +x dev` if the filesystem supports it):

```bash
#!/usr/bin/env bash
# Run a command inside the dev container. Nothing but Docker is needed on the host.
#
#   ./dev npm install
#   ./dev npm test
#   ./dev bash -lc "npx supabase start"
#   ./dev            # interactive shell
set -euo pipefail

COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/.devcontainer/docker-compose.yml"
export LOCAL_WORKSPACE_FOLDER="${LOCAL_WORKSPACE_FOLDER:-$(cd "$(dirname "$0")" && pwd)}"

# Start the service if it isn't already running.
if [ -z "$(docker compose -f "$COMPOSE_FILE" ps -q app 2>/dev/null)" ]; then
  docker compose -f "$COMPOSE_FILE" up -d app
fi

if [ "$#" -eq 0 ]; then
  exec docker compose -f "$COMPOSE_FILE" exec app bash
fi
exec docker compose -f "$COMPOSE_FILE" exec -T app "$@"
```

- [ ] **Step 5: Ensure .gitignore covers the basics**

`.gitignore` must contain at least:

```gitignore
node_modules
.next
.env*
!.env.example
supabase/.temp
.superpowers
```

- [ ] **Step 6: Build and verify the environment**

From the host (only Docker required):

```bash
./dev node --version                          # expect v22.x
./dev npm --version
./dev docker ps                               # expect a table, not a permission error
./dev getent hosts host.docker.internal       # expect an IP
./dev psql --version                          # expect 15.x or newer
./dev pwd                                     # expect /workspaces/hub
```

Expected: all six succeed. If `docker ps` prints a socket permission error, the container user lacks access to the mounted socket — re-run as root to confirm the socket works (`docker compose -f .devcontainer/docker-compose.yml exec -u root app docker ps`) and, if so, add `group_add: ["999"]` (the host's docker group GID) to the `app` service, or run the service as root by setting `"remoteUser": "root"`. Record whichever fix was needed in the task report.

**From here on, every command in this plan runs either through `./dev …` or in the VS Code container terminal — never on the host.**

- [ ] **Step 7: Commit and push**

```bash
git add .devcontainer dev .gitignore
git commit -m "feat: add dev container (Docker Desktop is the only host requirement)"
git push
```

---

### Task 1: Scaffold Next.js app with Vitest and CI

**Files:**
- Create: Next.js scaffold at repo root (`src/app/...`, `package.json`, `tsconfig.json`, etc.)
- Create: `vitest.config.ts`
- Create: `src/lib/hello.test.ts` (temporary CI canary, deleted in Task 4)
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the dev container from Task 0 (all commands run inside it).
- Produces: `npm run dev|build|lint|typecheck|test` all working; CI running lint + typecheck + test on push/PR.

- [ ] **Step 1: Scaffold the app (inside the dev container)**

```bash
cd /workspaces/hub
npx create-next-app@latest . --typescript --eslint --app --src-dir --no-tailwind --import-alias "@/*" --use-npm --yes
```

(`--no-tailwind` for now — styling decisions come with the UI-heavy milestones. If create-next-app balks at the non-empty directory because of `docs/`/`README.md`, scaffold into `tmp-app/` and move everything except `.git` up: `shopt -s dotglob && mv tmp-app/* . && rmdir tmp-app` — do not overwrite the existing `README.md`; keep ours and delete the generated one.)

- [ ] **Step 2: Add Vitest and scripts**

```bash
npm install -D vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

Add to `package.json` scripts (note `dev` binds `0.0.0.0` so the forwarded port works from the host browser):

```json
"dev": "next dev -H 0.0.0.0",
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Write the canary test**

Create `src/lib/hello.test.ts`:

```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Verify everything runs**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all four succeed; test output shows `1 passed`.

- [ ] **Step 5: Add CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
```

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with Vitest and CI"
git push
```

Then check: `gh run watch --exit-status` (CI green).

---

### Task 2: Supabase local setup and core schema migration

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`)
- Create: `supabase/migrations/<timestamp>_core_schema.sql`
- Create: `supabase/seed.sql`
- Create: `.env.example`
- Modify: `package.json` (add `supabase` devDependency + db scripts)

**Interfaces:**
- Consumes: dev container (Task 0), npm project (Task 1).
- Produces: tables `person`, `account_request`, `kiosk_device`, `app_setting`; enum `person_role`; local stack via `npm run db:start`; seed data (one student with `student_id_number = '1741'`).

- [ ] **Step 1: Install the Supabase CLI as a devDependency and initialize**

The CLI is a project dependency, never a host install — this is Supabase's recommended path and keeps the host clean per the global constraints.

```bash
npm install -D supabase
npx supabase init
npx supabase start
```

`npx supabase start` talks to the host Docker daemon through the mounted socket and prints the local URLs and keys. Copy `service_role key` and `anon key` into `.env.local` (Step 5). First run pulls several images and takes a few minutes.

Add convenience scripts to `package.json`:

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"db:psql": "psql postgresql://postgres:postgres@host.docker.internal:54322/postgres"
```

- [ ] **Step 2: Write the core schema migration**

```bash
npx supabase migration new core_schema
```

Fill the generated `supabase/migrations/<timestamp>_core_schema.sql`:

```sql
create type person_role as enum ('admin', 'mentor', 'captain', 'student');

create table person (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  display_name text,
  role person_role not null default 'student',
  grad_year integer,
  email text unique,
  phone text,
  shirt_size text,
  dietary_restrictions text,
  bio text,
  avatar_path text,
  is_active boolean not null default true,
  student_id_number text unique,
  auth_user_id uuid unique references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table account_request (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  grad_year integer,
  email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table kiosk_device (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_by uuid references person (id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table app_setting (
  key text primary key,
  value jsonb not null
);

alter table person enable row level security;
alter table account_request enable row level security;
alter table kiosk_device enable row level security;
alter table app_setting enable row level security;
-- Deliberately NO policies: default-deny; all access via service role (spec §3.5).

insert into app_setting (key, value)
values ('team_timezone', '"America/Indiana/Indianapolis"');
```

- [ ] **Step 3: Write dev seed data**

Create `supabase/seed.sql`:

```sql
insert into person (first_name, last_name, role, student_id_number, grad_year)
values ('Test', 'Student', 'student', '1741', 2028);
```

- [ ] **Step 4: Apply and verify**

Run: `npm run db:reset`
Expected: migration + seed apply cleanly.

Verify (from inside the container, so Postgres is at `host.docker.internal`):

```bash
npm run db:psql -- -c "select first_name, role, student_id_number from person;"
npm run db:psql -- -c "select key, value from app_setting;"
```

Expected: the Test Student row and the `team_timezone` setting.

- [ ] **Step 5: Env example**

Create `.env.example` — note the deliberate two-URL split from the global constraints:

```bash
# Browser-facing (host can reach this). Used only for Supabase Auth flows.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `npm run db:start`>

# Server-side (dev container reaches sibling containers via host.docker.internal).
# Leave unset in production — Vercel talks to hosted Supabase over the public URL.
SUPABASE_INTERNAL_URL=http://host.docker.internal:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `npm run db:start`>

# Student session signing secret: generate with `openssl rand -hex 32`
STUDENT_SESSION_SECRET=

# Mentor Google OAuth (Task 7; optional until credentials exist)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

Then `cp .env.example .env.local` and fill in the real values from the `db:start` output.

- [ ] **Step 6: Commit and push**

```bash
git add supabase .env.example package.json package-lock.json
git commit -m "feat: add Supabase core schema and containerized db scripts"
git push
```

---

### Task 3: Types, service-role DB client, and settings accessor

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/supabase-url.ts`
- Test: `src/lib/supabase-url.test.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: env vars from Task 2.
- Produces:
  - `type Role = "admin" | "mentor" | "captain" | "student" | "guest"`
  - `type Person = { id: string; firstName: string; lastName: string; displayName: string | null; role: Exclude<Role, "guest">; gradYear: number | null; email: string | null; isActive: boolean; studentIdNumber: string | null; authUserId: string | null }`
  - `personFromRow(row: PersonRow): Person`
  - `resolveServerSupabaseUrl(env: { SUPABASE_INTERNAL_URL?: string; NEXT_PUBLIC_SUPABASE_URL?: string }): string` and `serverSupabaseUrl(): string` — **every server-side Supabase client must use this**
  - `getDb(): SupabaseClient` (service-role, server-only)
  - `getSetting<T>(key: string, fallback: T, db?): Promise<T>`

- [ ] **Step 1: Write types**

Create `src/lib/types.ts`:

```ts
export type Role = "admin" | "mentor" | "captain" | "student" | "guest";

/** Row shape of the person table (snake_case, as returned by supabase-js). */
export type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  role: "admin" | "mentor" | "captain" | "student";
  grad_year: number | null;
  email: string | null;
  is_active: boolean;
  student_id_number: string | null;
  auth_user_id: string | null;
};

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: Exclude<Role, "guest">;
  gradYear: number | null;
  email: string | null;
  isActive: boolean;
  studentIdNumber: string | null;
  authUserId: string | null;
};

export function personFromRow(row: PersonRow): Person {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    role: row.role,
    gradYear: row.grad_year,
    email: row.email,
    isActive: row.is_active,
    studentIdNumber: row.student_id_number,
    authUserId: row.auth_user_id,
  };
}
```

- [ ] **Step 2a: Write the failing test for the server URL seam**

Create `src/lib/supabase-url.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveServerSupabaseUrl } from "./supabase-url";

describe("resolveServerSupabaseUrl", () => {
  test("prefers the internal URL when set (dev container → sibling containers)", () => {
    expect(
      resolveServerSupabaseUrl({
        SUPABASE_INTERNAL_URL: "http://host.docker.internal:54321",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBe("http://host.docker.internal:54321");
  });

  test("falls back to the public URL in production", () => {
    expect(
      resolveServerSupabaseUrl({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toBe("https://abc.supabase.co");
  });

  test("throws when neither is configured", () => {
    expect(() => resolveServerSupabaseUrl({})).toThrow();
  });
});
```

Run: `npm run test` → FAIL (module not found).

- [ ] **Step 2b: Implement the URL seam and the service-role client**

```bash
npm install @supabase/supabase-js @supabase/ssr server-only
```

Create `src/lib/supabase-url.ts`:

```ts
/**
 * Server-side Supabase base URL.
 *
 * In the dev container the Supabase stack runs as sibling containers on the host
 * daemon, so server code must reach it at host.docker.internal — `localhost`
 * would resolve to the app container itself. In production SUPABASE_INTERNAL_URL
 * is unset and the public URL is correct.
 */
export function resolveServerSupabaseUrl(env: {
  SUPABASE_INTERNAL_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}): string {
  const url = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Set SUPABASE_INTERNAL_URL (dev container) or NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  return url;
}

export function serverSupabaseUrl(): string {
  return resolveServerSupabaseUrl({
    SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
```

Create `src/lib/db.ts`:

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSupabaseUrl } from "./supabase-url";

let db: SupabaseClient | undefined;

/** Service-role client. Server-only — bypasses RLS by design (spec §3.5). */
export function getDb(): SupabaseClient {
  if (!db) {
    db = createClient(
      serverSupabaseUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return db;
}
```

Run: `npm run test` → PASS (URL seam tests).

- [ ] **Step 3: Write the failing settings test**

Create `src/lib/settings.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { getSetting } from "./settings";

function fakeDb(row: { value: unknown } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as never;
}

describe("getSetting", () => {
  test("returns stored value", async () => {
    const db = fakeDb({ value: "America/Indiana/Indianapolis" });
    expect(await getSetting("team_timezone", "UTC", db)).toBe(
      "America/Indiana/Indianapolis",
    );
  });

  test("returns fallback when key missing", async () => {
    expect(await getSetting("team_timezone", "UTC", fakeDb(null))).toBe("UTC");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `settings` module not found.

- [ ] **Step 5: Implement settings accessor**

Create `src/lib/settings.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getSetting<T>(
  key: string,
  fallback: T,
  db?: SupabaseClient,
): Promise<T> {
  const client = db ?? (await import("./db")).getDb();
  const { data, error } = await client
    .from("app_setting")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || data == null) return fallback;
  return data.value as T;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (settings tests + canary).

- [ ] **Step 7: Commit and push**

```bash
git add src/lib package.json package-lock.json
git commit -m "feat: add person types, server URL seam, db client, settings accessor"
git push
```

---

### Task 4: Student session tokens (JWT)

**Files:**
- Create: `src/lib/student-session.ts`
- Test: `src/lib/student-session.test.ts`
- Delete: `src/lib/hello.test.ts` (canary no longer needed)

**Interfaces:**
- Consumes: env `STUDENT_SESSION_SECRET`.
- Produces:
  - `STUDENT_SESSION_COOKIE = "hub_student_session"`
  - `createStudentSessionToken(personId: string, secret: string): Promise<string>` — 7-day expiry
  - `verifyStudentSessionToken(token: string, secret: string): Promise<{ personId: string } | null>`

- [ ] **Step 1: Write the failing tests**

```bash
npm install jose
```

Create `src/lib/student-session.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  createStudentSessionToken,
  verifyStudentSessionToken,
} from "./student-session";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("student session tokens", () => {
  test("round-trips a person id", async () => {
    const token = await createStudentSessionToken("person-123", SECRET);
    const result = await verifyStudentSessionToken(token, SECRET);
    expect(result).toEqual({ personId: "person-123" });
  });

  test("rejects a tampered token", async () => {
    const token = await createStudentSessionToken("person-123", SECRET);
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyStudentSessionToken(tampered, SECRET)).toBeNull();
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await createStudentSessionToken("person-123", "x".repeat(32));
    expect(await verifyStudentSessionToken(token, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `student-session` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/student-session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

export const STUDENT_SESSION_COOKIE = "hub_student_session";
const SESSION_DURATION = "7d";

export async function createStudentSessionToken(
  personId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ sub: personId, kind: "student" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyStudentSessionToken(
  token: string,
  secret: string,
): Promise<{ personId: string } | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    if (payload.kind !== "student" || typeof payload.sub !== "string") {
      return null;
    }
    return { personId: payload.sub };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass; remove canary**

Run: `npm run test` → PASS.

```bash
rm src/lib/hello.test.ts
npm run test
```

Expected: still PASS (student-session + settings suites).

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: add student session JWT create/verify"
git push
```

---

### Task 5: Role ranks and authorization helpers

**Files:**
- Create: `src/lib/authz.ts`
- Test: `src/lib/authz.test.ts`

**Interfaces:**
- Consumes: `Role` from Task 3.
- Produces:
  - `hasRole(actual: Role, required: Role): boolean` — rank order guest < student < captain < mentor < admin
  - `class ForbiddenError extends Error`
  - `requireRole(actual: Role, required: Role): void` — throws `ForbiddenError` when `hasRole` is false

- [ ] **Step 1: Write the failing tests**

Create `src/lib/authz.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ForbiddenError, hasRole, requireRole } from "./authz";

describe("hasRole", () => {
  test.each([
    ["guest", "guest", true],
    ["guest", "student", false],
    ["student", "student", true],
    ["student", "mentor", false],
    ["captain", "student", true],
    ["captain", "mentor", false],
    ["mentor", "captain", true],
    ["mentor", "admin", false],
    ["admin", "admin", true],
    ["admin", "guest", true],
  ] as const)("%s vs required %s → %s", (actual, required, expected) => {
    expect(hasRole(actual, required)).toBe(expected);
  });
});

describe("requireRole", () => {
  test("passes silently when allowed", () => {
    expect(() => requireRole("admin", "mentor")).not.toThrow();
  });

  test("throws ForbiddenError when denied", () => {
    expect(() => requireRole("student", "mentor")).toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `authz` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/authz.ts`:

```ts
import type { Role } from "./types";

const RANK: Record<Role, number> = {
  guest: 0,
  student: 1,
  captain: 2,
  mentor: 3,
  admin: 4,
};

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export class ForbiddenError extends Error {
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireRole(actual: Role, required: Role): void {
  if (!hasRole(actual, required)) throw new ForbiddenError();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add src/lib/authz.ts src/lib/authz.test.ts
git commit -m "feat: add role rank authorization helpers"
git push
```

---

### Task 6: Viewer resolution and student login route

**Files:**
- Create: `src/lib/viewer.ts`
- Test: `src/lib/viewer.test.ts`
- Create: `src/app/api/auth/student/route.ts`
- Create: `src/app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `verifyStudentSessionToken`/`createStudentSessionToken`/`STUDENT_SESSION_COOKIE` (Task 4), `Person`/`personFromRow` (Task 3).
- Produces:
  - `type Viewer = { person: Person | null; role: Role }` (guest ⇒ `{ person: null, role: "guest" }`)
  - `resolveViewer(deps): Promise<Viewer>` — pure core, dependency-injected
  - `getViewer(): Promise<Viewer>` — Next.js wrapper reading cookies; used by every route from now on
  - `POST /api/auth/student` `{ studentId: string }` → sets student cookie, returns `{ ok: true }`; 401 `{ ok: false }` on unknown/inactive ID
  - `POST /api/auth/logout` → clears both session types

- [ ] **Step 1: Write the failing tests for the pure core**

Create `src/lib/viewer.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveViewer } from "./viewer";
import type { PersonRow } from "./types";

const student: PersonRow = {
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
};

describe("resolveViewer", () => {
  test("supabase auth user resolves via auth_user_id", async () => {
    const mentorRow = { ...student, id: "p2", role: "mentor" as const, auth_user_id: "u9" };
    const viewer = await resolveViewer({
      supabaseUserId: "u9",
      studentToken: null,
      verifyToken: async () => null,
      findPersonByAuthUserId: async (id) => (id === "u9" ? mentorRow : null),
      findPersonById: async () => null,
    });
    expect(viewer.role).toBe("mentor");
    expect(viewer.person?.id).toBe("p2");
  });

  test("student token resolves via person id", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: "tok",
      verifyToken: async (t) => (t === "tok" ? { personId: "p1" } : null),
      findPersonByAuthUserId: async () => null,
      findPersonById: async (id) => (id === "p1" ? student : null),
    });
    expect(viewer.role).toBe("student");
    expect(viewer.person?.firstName).toBe("Test");
  });

  test("inactive person is treated as guest", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: "tok",
      verifyToken: async () => ({ personId: "p1" }),
      findPersonByAuthUserId: async () => null,
      findPersonById: async () => ({ ...student, is_active: false }),
    });
    expect(viewer).toEqual({ person: null, role: "guest" });
  });

  test("no session at all is guest", async () => {
    const viewer = await resolveViewer({
      supabaseUserId: null,
      studentToken: null,
      verifyToken: async () => null,
      findPersonByAuthUserId: async () => null,
      findPersonById: async () => null,
    });
    expect(viewer).toEqual({ person: null, role: "guest" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `viewer` module not found.

- [ ] **Step 3: Implement the pure core + Next.js wrapper**

Create `src/lib/viewer.ts`:

```ts
import type { PersonRow, Person, Role } from "./types";
import { personFromRow } from "./types";

export type Viewer = { person: Person | null; role: Role };

const GUEST: Viewer = { person: null, role: "guest" };

type ResolveDeps = {
  supabaseUserId: string | null;
  studentToken: string | null;
  verifyToken: (token: string) => Promise<{ personId: string } | null>;
  findPersonByAuthUserId: (authUserId: string) => Promise<PersonRow | null>;
  findPersonById: (id: string) => Promise<PersonRow | null>;
};

export async function resolveViewer(deps: ResolveDeps): Promise<Viewer> {
  if (deps.supabaseUserId) {
    const row = await deps.findPersonByAuthUserId(deps.supabaseUserId);
    if (row?.is_active) return { person: personFromRow(row), role: row.role };
  }
  if (deps.studentToken) {
    const claims = await deps.verifyToken(deps.studentToken);
    if (claims) {
      const row = await deps.findPersonById(claims.personId);
      if (row?.is_active) return { person: personFromRow(row), role: row.role };
    }
  }
  return GUEST;
}

/** Next.js wrapper: reads both session types from cookies. Server-only. */
export async function getViewer(): Promise<Viewer> {
  const { cookies } = await import("next/headers");
  const { createServerClient } = await import("@supabase/ssr");
  const { getDb } = await import("./db");
  const { STUDENT_SESSION_COOKIE, verifyStudentSessionToken } = await import(
    "./student-session"
  );

  const { serverSupabaseUrl } = await import("./supabase-url");

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // read-only here; auth callback handles writes
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const db = getDb();
  const findOne = async (col: string, val: string) => {
    const { data } = await db
      .from("person")
      .select("*")
      .eq(col, val)
      .maybeSingle();
    return data;
  };

  return resolveViewer({
    supabaseUserId: user?.id ?? null,
    studentToken: cookieStore.get(STUDENT_SESSION_COOKIE)?.value ?? null,
    verifyToken: (t) =>
      verifyStudentSessionToken(t, process.env.STUDENT_SESSION_SECRET!),
    findPersonByAuthUserId: (id) => findOne("auth_user_id", id),
    findPersonById: (id) => findOne("id", id),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Implement the student login and logout routes**

Create `src/app/api/auth/student/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createStudentSessionToken,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student-session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    studentId?: string;
  } | null;
  const studentId = body?.studentId?.trim();
  if (!studentId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: row } = await getDb()
    .from("person")
    .select("id, is_active")
    .eq("student_id_number", studentId)
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

Create `src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { STUDENT_SESSION_COOKIE } from "@/lib/student-session";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete(STUDENT_SESSION_COOKIE);
  // Supabase auth cookies are cleared client-side via supabase.auth.signOut()
  // on the login page; belt-and-suspenders: expire any sb-* cookies present.
  for (const cookie of request.headers.get("cookie")?.split("; ") ?? []) {
    const name = cookie.split("=")[0];
    if (name.startsWith("sb-")) response.cookies.delete(name);
  }
  return response;
}
```

- [ ] **Step 6: Manual verification against the local stack**

In the dev container, with `npm run db:start` already run and `.env.local` filled from Task 2:

```bash
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/auth/student \
  -H "Content-Type: application/json" -d '{"studentId":"1741"}' -i | head -8
curl -s -X POST http://localhost:3000/api/auth/student \
  -H "Content-Type: application/json" -d '{"studentId":"nope"}' -o /dev/null -w "%{http_code}\n"
```

Expected: first response `200` with a `Set-Cookie: hub_student_session=...` header; second prints `401`.

- [ ] **Step 7: Commit and push**

```bash
git add src/lib/viewer.ts src/lib/viewer.test.ts src/app/api/auth
git commit -m "feat: add viewer resolution and student ID login"
git push
```

---

### Task 7: Mentor Google OAuth with allowlist and first-user-admin bootstrap

**Files:**
- Create: `src/lib/oauth-link.ts`
- Test: `src/lib/oauth-link.test.ts`
- Create: `src/app/auth/callback/route.ts`
- Modify: `supabase/config.toml` (enable Google provider for local dev)

**Interfaces:**
- Consumes: `PersonRow` (Task 3), `getDb` (Task 3).
- Produces:
  - `type OAuthLinkDecision = { action: "bootstrap-admin" | "link" | "guest"; personId?: string }`
  - `decideOAuthLink(input: { matchedPerson: PersonRow | null; adminCount: number }): OAuthLinkDecision`
  - `GET /auth/callback?code=...` — exchanges the code, applies the decision (links `auth_user_id`, promotes first admin), redirects to `/`

Decision rules (spec §3.2, §3.4):
1. Zero admins exist → whoever just signed in becomes admin (`bootstrap-admin`): link + promote.
2. Google email matches a person with role mentor/admin/captain → `link` that person.
3. Otherwise → `guest` (session remains but resolves to guest because no person row links).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/oauth-link.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { decideOAuthLink } from "./oauth-link";
import type { PersonRow } from "./types";

const mentor: PersonRow = {
  id: "p5",
  first_name: "Ada",
  last_name: "Mentor",
  display_name: null,
  role: "mentor",
  grad_year: null,
  email: "ada@example.org",
  is_active: true,
  student_id_number: null,
  auth_user_id: null,
};

describe("decideOAuthLink", () => {
  test("first user ever becomes admin even with no person match", () => {
    expect(decideOAuthLink({ matchedPerson: null, adminCount: 0 })).toEqual({
      action: "bootstrap-admin",
    });
  });

  test("matching mentor person links", () => {
    expect(decideOAuthLink({ matchedPerson: mentor, adminCount: 2 })).toEqual({
      action: "link",
      personId: "p5",
    });
  });

  test("matching student person does NOT link via oauth (stays guest)", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, role: "student" },
        adminCount: 2,
      }),
    ).toEqual({ action: "guest" });
  });

  test("no match with admins present stays guest", () => {
    expect(decideOAuthLink({ matchedPerson: null, adminCount: 3 })).toEqual({
      action: "guest",
    });
  });

  test("inactive person stays guest", () => {
    expect(
      decideOAuthLink({
        matchedPerson: { ...mentor, is_active: false },
        adminCount: 2,
      }),
    ).toEqual({ action: "guest" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `oauth-link` module not found.

- [ ] **Step 3: Implement the decision function**

Create `src/lib/oauth-link.ts`:

```ts
import type { PersonRow } from "./types";

export type OAuthLinkDecision = {
  action: "bootstrap-admin" | "link" | "guest";
  personId?: string;
};

const OAUTH_LINKABLE_ROLES = new Set(["admin", "mentor", "captain"]);

export function decideOAuthLink(input: {
  matchedPerson: PersonRow | null;
  adminCount: number;
}): OAuthLinkDecision {
  if (input.adminCount === 0) return { action: "bootstrap-admin" };
  const p = input.matchedPerson;
  if (p && p.is_active && OAUTH_LINKABLE_ROLES.has(p.role)) {
    return { action: "link", personId: p.id };
  }
  return { action: "guest" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Implement the callback route**

Create `src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getDb } from "@/lib/db";
import { serverSupabaseUrl } from "@/lib/supabase-url";
import { decideOAuthLink } from "@/lib/oauth-link";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirect = NextResponse.redirect(new URL("/", request.url));
  if (!code) return redirect;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            redirect.cookies.set(name, value, options),
          ),
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return redirect;

  const email = data.user.email?.toLowerCase();
  const db = getDb();

  const [{ data: matched }, { count }] = await Promise.all([
    email
      ? db.from("person").select("*").eq("email", email).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("person")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin"),
  ]);

  const decision = decideOAuthLink({
    matchedPerson: matched ?? null,
    adminCount: count ?? 0,
  });

  if (decision.action === "bootstrap-admin") {
    if (matched) {
      await db
        .from("person")
        .update({ role: "admin", auth_user_id: data.user.id })
        .eq("id", matched.id);
    } else {
      const meta = (data.user.user_metadata ?? {}) as Record<string, string>;
      await db.from("person").insert({
        first_name: meta.given_name ?? meta.name ?? "Admin",
        last_name: meta.family_name ?? "",
        email,
        role: "admin",
        auth_user_id: data.user.id,
      });
    }
  } else if (decision.action === "link") {
    await db
      .from("person")
      .update({ auth_user_id: data.user.id })
      .eq("id", decision.personId!);
  }
  // "guest": session exists but links to no person → getViewer() returns guest.

  return redirect;
}
```

- [ ] **Step 6: Enable Google provider for local dev**

In `supabase/config.toml`, set:

```toml
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"
secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
```

The vars are already in `.env.example` from Task 2; fill real values in `.env.local` (from a Google Cloud OAuth client — created once in the Google Cloud console; the production Supabase project gets the same pair in its dashboard). Then restart the stack: `npm run db:stop && npm run db:start`.

**Note:** if no Google OAuth client exists yet, this step can't be completed locally — commit the config, verify the decision-function tests pass, and flag OAuth end-to-end verification as pending credentials in the task report. Everything else in M1 works without it.

- [ ] **Step 7: Typecheck, lint, build**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit and push**

```bash
git add src/lib/oauth-link.ts src/lib/oauth-link.test.ts src/app/auth supabase/config.toml
git commit -m "feat: add mentor OAuth callback with allowlist and first-admin bootstrap"
git push
```

---

### Task 8: Login page, account requests, and viewer-aware home page

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/components/StudentLoginForm.tsx`
- Create: `src/components/GoogleSignInButton.tsx`
- Create: `src/components/AccountRequestForm.tsx`
- Create: `src/lib/supabase-browser.ts`
- Create: `src/app/api/account-request/route.ts`
- Modify: `src/app/page.tsx` (replace scaffold home)

**Interfaces:**
- Consumes: `getViewer` (Task 6), student login route (Task 6), OAuth callback (Task 7).
- Produces:
  - `POST /api/account-request` `{ firstName, lastName, gradYear?, email? }` → inserts pending `account_request`, returns `{ ok: true }`
  - `/login` page with all three entry points
  - `/` home page greeting the viewer by role (proves the full loop)

- [ ] **Step 1: Browser Supabase client**

Create `src/lib/supabase-browser.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

(No `"use client"` directive needed — this module is only imported from client components. The anon key here is used solely for Supabase Auth flows, never for data access, per the spec's RLS seam.)

- [ ] **Step 2: Account request route**

Create `src/app/api/account-request/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    gradYear?: number;
    email?: string;
  } | null;

  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  if (!firstName || !lastName) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await getDb().from("account_request").insert({
    first_name: firstName,
    last_name: lastName,
    grad_year: body?.gradYear ?? null,
    email: body?.email?.trim() || null,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Login page and forms**

Create `src/components/StudentLoginForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StudentLoginForm() {
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/student", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("ID not recognized. Check with a mentor.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Student ID
        <input
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          autoFocus
          required
        />
      </label>
      <button type="submit">Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

Create `src/components/GoogleSignInButton.tsx`:

```tsx
"use client";

import { getSupabaseBrowser } from "@/lib/supabase-browser";

export function GoogleSignInButton() {
  async function signIn() {
    await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button type="button" onClick={signIn}>
      Mentor sign in with Google
    </button>
  );
}
```

Create `src/components/AccountRequestForm.tsx`:

```tsx
"use client";

import { useState } from "react";

export function AccountRequestForm() {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const gradYearRaw = String(form.get("gradYear") ?? "").trim();
    const res = await fetch("/api/account-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        gradYear: gradYearRaw ? Number(gradYearRaw) : undefined,
        email: form.get("email") || undefined,
      }),
    });
    setState(res.ok ? "sent" : "error");
  }

  if (state === "sent") {
    return <p>Request sent! A mentor will set you up at the next meeting.</p>;
  }
  return (
    <form onSubmit={submit}>
      <input name="firstName" placeholder="First name" required />
      <input name="lastName" placeholder="Last name" required />
      <input name="gradYear" placeholder="Grad year (optional)" inputMode="numeric" />
      <input name="email" placeholder="Email (optional)" type="email" />
      <button type="submit">Request an account</button>
      {state === "error" && <p role="alert">Something went wrong — try again.</p>}
    </form>
  );
}
```

Create `src/app/login/page.tsx`:

```tsx
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { StudentLoginForm } from "@/components/StudentLoginForm";
import { AccountRequestForm } from "@/components/AccountRequestForm";

export default function LoginPage() {
  return (
    <main>
      <h1>Team Hub — Sign in</h1>
      <section>
        <h2>Students</h2>
        <StudentLoginForm />
        <details>
          <summary>New student? Request an account</summary>
          <AccountRequestForm />
        </details>
      </section>
      <section>
        <h2>Mentors</h2>
        <GoogleSignInButton />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Viewer-aware home page**

Replace `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { getViewer } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewer();
  return (
    <main>
      <h1>Team Hub</h1>
      {viewer.person ? (
        <>
          <p>
            Signed in as {viewer.person.displayName ?? viewer.person.firstName}{" "}
            ({viewer.role})
          </p>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <p>
          Browsing as guest. <Link href="/login">Sign in</Link>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Manual verification of the full loop**

With `npm run db:start` + `npm run dev` in the container, use the **host browser** at `http://localhost:3000` (VS Code forwards port 3000):

1. Open `http://localhost:3000/` → "Browsing as guest".
2. `/login` → student form → enter `1741` → home shows "Signed in as Test (student)".
3. Sign out → guest again.
4. Submit an account request → in the container, `npm run db:psql -- -c "select first_name, status from account_request;"` shows the pending row.

Expected: all four behave as described.

- [ ] **Step 6: Lint, typecheck, test, build; commit and push**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
git add src
git commit -m "feat: add login page, account requests, viewer-aware home"
git push
```

---

### Task 9: Guest read-only enforcement pattern + README

**Files:**
- Create: `src/app/api/whoami/route.ts`
- Create: `src/app/api/admin/ping/route.ts`
- Create: `src/lib/api.ts`
- Test: `src/lib/api.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getViewer` (Task 6), `requireRole`/`ForbiddenError` (Task 5).
- Produces:
  - `withRole(required: Role, handler: (viewer: Viewer, request: Request) => Promise<Response>): (request: Request) => Promise<Response>` — the guard every protected route in M2+ uses; returns 403 JSON on `ForbiddenError`
  - `GET /api/whoami` → `{ role, name | null }` (open to guests — proves guests get real, scoped responses)
  - `GET /api/admin/ping` → 403 for everyone below admin, `{ ok: true }` for admin

- [ ] **Step 1: Write the failing tests**

Create `src/lib/api.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { withRole } from "./api";
import type { Viewer } from "./viewer";

function handlerFor(viewer: Viewer) {
  return withRole(
    "admin",
    async () => Response.json({ ok: true }),
    async () => viewer,
  );
}

describe("withRole", () => {
  test("admin passes through", async () => {
    const res = await handlerFor({
      person: {
        id: "p1", firstName: "A", lastName: "B", displayName: null,
        role: "admin", gradYear: null, email: null, isActive: true,
        studentIdNumber: null, authUserId: null,
      },
      role: "admin",
    })(new Request("http://test/api/admin/ping"));
    expect(res.status).toBe(200);
  });

  test("guest gets 403", async () => {
    const res = await handlerFor({ person: null, role: "guest" })(
      new Request("http://test/api/admin/ping"),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `api` module not found.

- [ ] **Step 3: Implement the guard**

Create `src/lib/api.ts`:

```ts
import { ForbiddenError, requireRole } from "./authz";
import type { Role } from "./types";
import type { Viewer } from "./viewer";

type Handler = (viewer: Viewer, request: Request) => Promise<Response>;

export function withRole(
  required: Role,
  handler: Handler,
  viewerSource?: () => Promise<Viewer>, // injectable for tests
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
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
    return handler(viewer, request);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Example routes**

Create `src/app/api/whoami/route.ts`:

```ts
import { getViewer } from "@/lib/viewer";

export async function GET() {
  const viewer = await getViewer();
  return Response.json({
    role: viewer.role,
    name: viewer.person
      ? (viewer.person.displayName ?? viewer.person.firstName)
      : null,
  });
}
```

Create `src/app/api/admin/ping/route.ts`:

```ts
import { withRole } from "@/lib/api";

export const GET = withRole("admin", async () => Response.json({ ok: true }));
```

Verify manually:

```bash
curl -s http://localhost:3000/api/whoami
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/ping
```

Expected: `{"role":"guest","name":null}` and `403`.

- [ ] **Step 6: Rewrite README**

Replace `README.md` body with: project one-liner, links to the spec/roadmap (`docs/specs/2026-08-10-v1-design.md`, `docs/plans/2026-08-10-v1-milestones.md`), and dev setup:

```markdown
# Team Hub

Attendance + roster web app for FRC Team 1741 (Red Alert Robotics).

- Spec: [docs/specs/2026-08-10-v1-design.md](docs/specs/2026-08-10-v1-design.md)
- Roadmap: [docs/plans/2026-08-10-v1-milestones.md](docs/plans/2026-08-10-v1-milestones.md)
- Research: [docs/research/](docs/research/)

## Development

**Host requirements: Docker Desktop, VS Code (Dev Containers extension), a browser. Nothing else** —
Node, npm, the Supabase CLI, and psql all live inside the dev container.

1. Clone the repo and open it in VS Code.
2. Command Palette → **Dev Containers: Reopen in Container**.
3. In the container terminal:

       npm install
       npm run db:start            # starts local Supabase (sibling containers)
       cp .env.example .env.local  # fill in keys printed by db:start
       npm run dev

4. Open http://localhost:3000 in your host browser. Supabase Studio is at http://localhost:54323.

Tests & checks: `npm run test`, `npm run lint`, `npm run typecheck`.
Database: `npm run db:reset` (re-apply migrations + seed), `npm run db:psql` (SQL shell), `npm run db:stop`.

### Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.
```

- [ ] **Step 7: Full check; commit and push**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
git add -A
git commit -m "feat: add withRole guard, example guarded routes, README"
git push
```

Then check CI: `gh run watch --exit-status`.

---

## Self-review notes

- **Spec coverage (M1 slice):** §2 stack ✓ (T1–T2), §3.1 person/user split ✓ (T2–T3), §3.2 mentor OAuth + allowlist ✓ (T7), §3.3 student sessions + `getViewer()` ✓ (T4, T6), §3.4 account requests + bootstrap ✓ (T7–T8), §3.5 seam: RLS default-deny zero policies ✓ (T2) + app-code authz ✓ (T5, T9). §3.6 kiosk tokens: `kiosk_device` table lands here (T2); the kiosk endpoints themselves are M3 scope by design.
- **Deliberately out of M1:** teams/periods/sessions tables and everything user-facing beyond login/home — they belong to M2/M3 where their features land, so migrations stay reviewable.
- **Admin review UI for account requests is M2** (`/admin/requests`); M1 only accepts submissions (verified via psql).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git workflow

- Commit at logical checkpoints during implementation, not just at the end — don't batch an
  entire feature into one commit.
- Push the branch as commits land, not only when finished.
- Branch names: a few words, hyphenated, describing the change at a high level (e.g.
  `dietary-restrictions-report`, `fix-flaky-attendance-test`).
- Every change starts in an isolated worktree — never commit directly on `master`/`main` in the
  main checkout. **Create one with `scripts/new-worktree.sh <branch-name>`** — this is the
  standard path; it lands the worktree under `.worktrees/` and starts its isolated stack. A plain
  `git worktree add` also works (the harness-agnostic `post-checkout` hook gives any new worktree
  its own Docker Compose stack + Supabase instance on unused ports). Prefer the script; don't rely
  on editor/agent-native worktree tooling (`claude --worktree` and friends) — it's flaky on this
  repo's Windows/WSL2 + Docker setup. See [dev-notes](docs/dev-notes.md#worktree-lifecycle).
- **Tearing a worktree down: run `docker compose down` from inside it first, then
  `git worktree remove <path>`.** The `down` lets the app container's SIGTERM trap run
  `supabase stop` (cleaning all sibling containers) and releases the bind-mount file handles, so
  the directory deletes cleanly. **Never hard-kill the Docker engine to "reset"** — on Windows/WSL2
  that SIGKILLs every container (Exit 137), transiently breaks in-container `supabase start`, and
  leaves WSL-locked empty directory husks that only a reboot clears. Merged worktrees also clean
  themselves up (stack, directory, local branch) on the next `git pull` on master or the next
  session start; `npm run worktrees:reap` forces it.
- When a plan/implementation is complete, skip the `finishing-a-development-branch` skill's
  "which option?" menu — go straight to **push + create PR** (`gh pr create`), then report the
  URL. Test verification and base-branch confirmation from that skill still apply; the worktree is
  still kept. Only the menu prompt itself is replaced by an automatic default of Option 2.
- Discarding work still requires the user's explicit typed `discard` — that path is unchanged.
- **`master` auto-deploys to production** (Vercel, on every push). Merging a PR is a production
  deploy.
- Schema changes reach prod via `supabase db push` of the committed migration — see
  [Database & migrations](#database--migrations) below.

## Running commands

Everything runs in Docker — the host has only Docker Desktop and a browser. Never run
`node`/`npm`/`supabase`/`psql` directly on the host.

- Bring the stack up: `docker compose up` (app + local Supabase together). It prints this
  worktree's URLs on startup.
- Run any one-off command in the container with the `./dev` helper: `./dev npm run test`,
  `./dev npm run db:reset`, `./dev bash`. It joins the running stack (starting it if needed).
- Never `docker rm`/`stop` the app container to "clear a stale build" — rebuild in place with
  `docker compose up -d --build`. See [dev-notes](docs/dev-notes.md).

### Ports are per-worktree, not fixed

Each worktree/branch runs its own isolated Docker + Supabase stack on offset-derived host ports
(the main checkout is offset 0; each new worktree takes the next free offset). Derived from the
offset `N`:

| Service | Host port | Offset 0 | Offset 1 |
| --- | --- | --- | --- |
| App | `3000 + N` | 3000 | 3001 |
| Supabase API | `54321 + N*10` | 54321 | 54331 |
| Supabase DB | `54322 + N*10` | 54322 | 54332 |
| Supabase Studio | `54323 + N*10` | 54323 | 54333 |

Don't assume `:3000`/`:54323`. This worktree's actual host ports are in its `.env`
(`APP_PORT`, `SUPABASE_STUDIO_PORT`, …) and are printed when the stack starts. **Inside the
container** (anything run via `./dev`) the app is always at `localhost:3000` regardless of offset —
only host-side URLs shift. See [dev-notes — Worktree lifecycle](docs/dev-notes.md#worktree-lifecycle).

## Before you finish

Run these in the container and confirm they pass before opening a PR:

    ./dev npm run lint
    ./dev npm run typecheck
    ./dev npm run test
    ./dev npm run e2e     # Playwright; needs the stack running (hits localhost:3000 in-container)

For UI changes, verify in a browser at this worktree's app URL (`http://localhost:$APP_PORT` —
see [Running commands](#running-commands)). In non-production the `/login` page has one-click
**Log in as Student / Mentor / Admin** buttons (dev-login), so you can reach any role without
Google OAuth.

## Database & migrations

- Every schema change is a committed migration file under `supabase/migrations/`, replayed
  verbatim to every environment. Never hand-run ad-hoc SQL for a schema change.
- **Never edit an already-applied migration in place.** `supabase db push` tracks by version
  (timestamp), not content, so an edit to an applied file is silently skipped. A correction is
  always a NEW migration file.
- Don't apply repo migrations with the Supabase MCP `apply_migration` tool — it stamps its own
  version and drifts prod's history from the committed files. Use `supabase db push`.
  (`apply_migration` is only for genuinely one-off prod-only SQL that will never be a repo file.)
- Tables use RLS with **zero policies** (service-role-only by design). Don't add policies or try
  to "fix" the `rls_enabled_no_policy` advisories — they're expected. A new table needs a
  service_role GRANT migration, or every query 42501s on a fresh DB.
- Always check `error` on `.select()`; for a table with 2+ FKs to the same parent, disambiguate
  the embed with an FK hint (`person!person_id (...)`) or PostgREST returns PGRST201 and the read
  silently comes back empty. See [dev-notes](docs/dev-notes.md).

## Container networking seam

The browser and in-container server code reach Supabase at different URLs. Two rules follow:

- Server code must resolve the Supabase URL through `serverSupabaseUrl()`
  (`src/lib/supabase-url.ts`), never a hardcoded/public URL.
- Every `@supabase/ssr` auth client must pass `cookieOptions: { name: AUTH_COOKIE_NAME }` from
  `src/lib/supabase-cookie.ts`, or OAuth/session cookies break across the seam.

Why, in full: [dev-notes — "Why two Supabase URLs"](docs/dev-notes.md).

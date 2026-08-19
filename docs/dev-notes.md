# Dev notes

Environment gotchas and non-obvious wiring worth knowing when working on Team Hub locally. The
day-to-day setup/run commands live in the [README](../README.md#development).

## Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.

## Local dev only runs correctly in the app container

Always start the stack with `docker compose up` (or `./dev`) — never run `next dev` directly on
the Windows/host machine. `host.docker.internal` does not resolve quickly (or at all) from outside
a container, so any server code that calls `serverSupabaseUrl()` hangs for 15–45s or times out
entirely, even though Kong/Postgrest/the DB all respond instantly to direct requests. Symptom:
unauthenticated requests (no DB call) return fast, but anything that hits the DB stalls.

Never `docker rm`/`docker stop` the app container (`team-hub-app-1`, or `hub-<worktree>-app-1` in
a worktree) to "clear out a stale build." It isn't disposable scratch space — it's the running dev
server. If it's serving outdated code, rebuild it in place instead:

```
docker compose up -d --build
```

Removing/stopping it has been observed to destabilize the Docker Desktop backend badly enough to
take down the sibling `supabase_*_hub` containers for the whole project, not just the app. If that
happens:

```
npx supabase start   # or `stop` — either resyncs; restores from its own backup, no data loss
docker compose up -d --build
```

## Worktree lifecycle

Every worktree gets its own app container and Supabase suite on its own ports, and cleans itself
up once its PR merges. This is wired into **git's** hooks, not any one agent's, so it works the
same under plain `git worktree add`, an IDE, or whichever agent harness you're using this week.

Install (idempotent, also runs automatically from `npm install`):

```
npm run worktrees:install     # scripts/install-git-hooks.sh
```

That appends two marker-delimited blocks to `.git/hooks/`, alongside whatever else lives there:

| Hook | Fires when | Does |
| --- | --- | --- |
| `post-checkout` | a new **linked** worktree is created (`$1` all-zeros) | `scripts/worktree-init.sh` — writes `.env`, `.env.local`, rewrites `supabase/config.toml` ports, starts the stack |
| `post-merge` | `git pull`/`git merge` lands on master in the **main** checkout | `scripts/reap-worktrees.sh` in the background |

`scripts/install-git-hooks.sh --uninstall` removes only those blocks. Nothing else in the repo
depends on them being there; agent-specific hooks under `.claude/hooks/` are thin wrappers that
call the same two scripts sooner, and deleting them costs only promptness.

### Ports

Each worktree claims the lowest unused `WORKTREE_OFFSET` and derives everything from it: app on
`3000 + offset`, Supabase API/DB/Studio on `5432x + offset * 10`. The offset scan reads the `.env`
of every worktree in `git worktree list`, so worktrees living outside the repo (`~/.t3`,
`~/.herdr`) are counted and can't collide. The main checkout is always offset 0.

A worktree's `.env` inherits the main checkout's (Google OAuth secrets and friends — `supabase
start` and the app both need them) with only the port/project keys overridden.

### Cleanup

`scripts/reap-worktrees.sh` is safe to run any time, from anywhere in the repo. It drains deferred
removals, downs stacks with no matching worktree, and for each merged branch: `docker compose down
-v`, `git worktree remove` (**never** `--force`), `git branch -D`.

"Merged" is answered by `gh pr list --head <branch> --state merged` first, because a squash merge
leaves no trace in local history. If gh can't answer (offline, no GitHub remote, not logged in) it
falls back to `git merge-base --is-ancestor` **plus** a check that the branch has more than one
reflog entry — a branch nobody has committed to yet is an ancestor of master by definition, and
reaping on that basis would delete a worktree somebody had only just started in.

Two deliberate limits: a squash-merged branch is not reapable while offline (gh is the only oracle
that sees it), and merged **remote** branches are left alone — cleaning up origin is your call.

### Knobs

| Variable | Effect |
| --- | --- |
| `WORKTREE_SKIP_UP=1` | write config, don't start containers |
| `WORKTREES_DIR` | where `scripts/new-worktree.sh` puts worktrees (default `.worktrees/`) |
| `REAP_SKIP_DOCKER=1` | reap worktrees without touching containers |
| `HUB_WORKTREE_SETUP` | set while setup calls `git worktree add`, so its own hook doesn't re-enter |

`npm run test:worktrees` exercises the whole lifecycle against a throwaway repo in `$TMPDIR` — no
Docker, no network, doesn't touch your checkout.

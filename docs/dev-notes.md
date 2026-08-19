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

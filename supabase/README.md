# Supabase local dev — script flags, don't remove

The `db:*` scripts in `package.json` run the Supabase CLI *inside the dev container*.
The CLI's own defaults assume it's running directly on the Docker host, so a couple of
flags are required here that would otherwise look unnecessary. Please keep them.

- **`db:start` uses `--ignore-health-check`.** Without it, `supabase start` fails after
  all containers are already healthy, because its post-start check hits
  `http://127.0.0.1:54321/...` to confirm readiness — and `127.0.0.1` from inside the
  dev container is the container's own loopback, not the host's published ports. The
  services are genuinely up; the CLI just can't verify it from here.

- **`db:reset` uses an explicit `--db-url postgresql://postgres:postgres@host.docker.internal:54322/postgres?sslmode=disable`.**
  Plain `supabase db reset` fails immediately with `ECONNREFUSED 127.0.0.1:54322` for
  the same reason. `host.docker.internal` is how the dev container reaches sibling
  containers on the host; `sslmode=disable` is required because local Postgres doesn't
  speak TLS. The `postgres:postgres` credential is the well-known Supabase **local-only**
  dev default — never point this URL at a real or hosted database.

- **Caveat:** because `--db-url` routes through the CLI's remote-reset code path, this
  `db:reset` does a schema drop/reapply (migrations + seed) against the running
  database, not the CLI's full local-teardown behavior (it won't recreate volumes or
  restart the `auth`/`storage` containers). That's sufficient for this project, but
  don't assume it's identical to a bare `supabase db reset` on a host machine.

See `.superpowers/sdd/2026-08-10-m1-foundation-auth/task-2-report.md` for the full
investigation and verification output.

# Team Hub

Attendance + roster web app for FRC Team 1741 (Red Alert Robotics).

- **Features** (what's built): [docs/features.md](docs/features.md)
- **UI & design system**: [docs/design/ui-system.md](docs/design/ui-system.md)
- **Spec**: [docs/specs/2026-08-10-v1-design.md](docs/specs/2026-08-10-v1-design.md)
- **Roadmap**: [docs/plans/2026-08-10-v1-milestones.md](docs/plans/2026-08-10-v1-milestones.md)
- **Research**: [docs/research/](docs/research/)
- **Deploy & setup**: [deploy runbook](docs/setup/deploy.md) ·
  [Google OAuth](docs/setup/google-oauth.md) · [Google Calendar](docs/setup/google-calendar.md)
- **Dev notes** (environment gotchas): [docs/dev-notes.md](docs/dev-notes.md)

## Development

**Host requirements: Docker Desktop, a browser. Nothing else** — Node, npm, the Supabase CLI,
and psql all live inside the dev container. (VS Code with the Dev Containers extension is
optional; see below.)

### Quick start — one command

From the repo root:

    docker compose up

That builds the dev container and runs [`scripts/dev-up.sh`](scripts/dev-up.sh) inside it, which
installs npm deps (first run only), starts local Supabase (sibling containers), and starts the
Next.js dev server — all together, with logs streaming. Add `-d` to run it in the background.

- App: http://localhost:3000 · Supabase Studio: http://localhost:54323
- `docker compose down` stops **both** the app container and local Supabase (the startup script
  traps the shutdown signal and runs `supabase stop`; your DB data is preserved across restarts).
- First run needs `.env.local` — `cp .env.example .env.local` and fill in the keys. The committed
  local Supabase keys are stable demo JWTs, so the checked-in `.env.local` values just work.

### Running one-off commands

- **`./dev` helper** (host shell): `./dev npm run test`, `./dev npm run db:psql`, `./dev bash`
  for an interactive shell. It execs into the running app container (starting it if needed).
- **VS Code "Reopen in Container"**: Command Palette → **Dev Containers: Reopen in Container**,
  then run commands in the integrated terminal (already inside the container).

Note: `docker compose up` and VS Code "Reopen in Container" share the same container (project
`team-hub`) but start it with different commands — the former runs the full stack, the latter
just idles so you drive it by hand. Switching between the two recreates the container; that's
expected. Use one mode at a time.

Tests & checks: `./dev npm run test`, `./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run build`.
Database: `./dev npm run db:reset` (re-apply migrations + seed), `./dev npm run db:psql` (SQL shell),
`./dev npm run db:stop`.

Run `git` on the **host**, not through `./dev` — the container has no git credentials.

Environment gotchas (e.g. why there are two Supabase URLs) live in [docs/dev-notes.md](docs/dev-notes.md).

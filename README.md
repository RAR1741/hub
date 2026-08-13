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

**Host requirements: Docker Desktop, VS Code (Dev Containers extension), a browser. Nothing else** —
Node, npm, the Supabase CLI, and psql all live inside the dev container.

Two ways to run commands inside the container — use whichever fits:

- **`./dev` helper** (host shell, no editor needed): `./dev npm install`, `./dev npm run dev`,
  `./dev bash` for an interactive shell. It starts the container if it isn't already running.
- **VS Code "Reopen in Container"**: Command Palette → **Dev Containers: Reopen in Container**,
  then run commands directly in the integrated terminal (already inside the container).

Setup:

    ./dev npm install
    ./dev npm run db:start            # starts local Supabase (sibling containers)
    cp .env.example .env.local        # fill in keys printed by db:start
    ./dev npm run dev

Open http://localhost:3000 in your host browser. Supabase Studio is at http://localhost:54323.

Tests & checks: `./dev npm run test`, `./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run build`.
Database: `./dev npm run db:reset` (re-apply migrations + seed), `./dev npm run db:psql` (SQL shell),
`./dev npm run db:stop`.

Run `git` on the **host**, not through `./dev` — the container has no git credentials.

Environment gotchas (e.g. why there are two Supabase URLs) live in [docs/dev-notes.md](docs/dev-notes.md).

# Team Hub

Attendance + roster web app for FRC Team 1741 (Red Alert Robotics).

- Spec: [docs/specs/2026-08-10-v1-design.md](docs/specs/2026-08-10-v1-design.md)
- Roadmap: [docs/plans/2026-08-10-v1-milestones.md](docs/plans/2026-08-10-v1-milestones.md)
- Research: [docs/research/](docs/research/)

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

### What's built so far

- Login: student ID sign-in and mentor Google sign-in
- Role-scoped roster (`/people`) and profiles
- Teams with join/apply (`/teams`)
- Admin pages: `/admin/people`, `/admin/teams`, `/admin/requests`
- Kiosk sign-in/out (`/kiosk`), who's-here board, leaderboard (`/leaderboard`), per-member hours
- Attendance periods (`/admin/periods`), flagged-session review (`/admin/sessions/flagged`),
  kiosk device management (`/admin/kiosk-devices`)
- Nightly auto-close sweep for sessions left open past the day boundary

### Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.

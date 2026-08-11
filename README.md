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

### What's built so far — v1 feature-complete

- Roster + teams: role-scoped roster (`/people`) and profiles, teams with join/apply (`/teams`),
  admin pages for people/teams/requests
- Split-audience auth: student ID sign-in and mentor Google OAuth sign-in, with first-Google-sign-in
  bootstrapping the admin account
- Kiosk sign-in/out (`/kiosk`), who's-here board, and a device-registration flow
  (`/admin/kiosk-devices`)
- Attendance periods (`/admin/periods`), hours + leaderboard (`/leaderboard`), per-member hour detail
- Flagged-session review (`/admin/sessions/flagged`) and a nightly auto-close sweep for sessions left
  open past the day boundary
- Google Calendar sync (hourly, via pg_cron/pg_net) with required/optional build days and excusals
- `/calendar` — the attendance grid across build days
- `/me/attendance` — a member's own attendance summary
- `/admin/settings` — timezone, calendar ID, auto-close/max-shift hours, kiosk-devices link
- A Playwright smoke suite (kiosk round trip, guest read-only, student login, mentor session edit),
  run in CI on every push/PR alongside lint/typecheck/unit tests
- A deploy runbook (`docs/setup/deploy.md`) covering the hosted Supabase project, Vercel, production
  Google OAuth, and the calendar-sync cron

The Google Calendar end-to-end (real service account + shared calendar) and the production deploy
itself are user-driven — they need real accounts/credentials that can't be created autonomously; see
`docs/setup/google-calendar.md` and `docs/setup/deploy.md`.

## UI / design system

Styling is Tailwind CSS v4, CSS-first — there's no `tailwind.config.js`; everything (theme tokens,
dark-mode variants, and the shared component classes) lives in `src/app/globals.css` via
`@import "tailwindcss"`, an `@theme` block, and a small `@layer components`. The tokens define the
brand red, neutral surface/border/text scale, and attendance status colors (present/excused/
optional/absent), each with a light and `prefers-color-scheme: dark` value.

Pages are built from semantic HTML (`<main>`, `<table>`, `<form>`, `<label>`, headings) styled with
Tailwind utility classes plus a handful of reusable component classes: `.btn`/`.btn-primary`/
`.btn-secondary`/`.btn-danger`, `.card`, `.label`, `.input`, `.badge`/`.badge-present` etc., and
`.table`. Wide tables sit inside an `overflow-x-auto` wrapper so they scroll on narrow viewports
instead of breaking the layout. Reach for the existing component classes and utilities before adding
new bespoke CSS.

### Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.

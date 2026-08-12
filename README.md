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

Team Hub's look is a "shop-floor control panel" — warm-neutral surfaces, Red Alert red, a cool
steel secondary, and mono data readouts — approved in `docs/design/ui-direction-mockup.html` (open
it locally; it has its own light/dark/system toggle and is the visual source of truth).

Styling is Tailwind CSS v4, CSS-first — there's no `tailwind.config.js`; everything (theme tokens,
dark-mode variants, and the shared component layer) lives in `src/app/globals.css` via
`@import "tailwindcss"`, a token `:root` block, and a `@layer components`.

**Fonts.** Self-hosted via `next/font/google` in `src/app/layout.tsx` (build-time — no runtime CDN
request): **Archivo** for display/headings, **Inter** for body/UI text, **JetBrains Mono** for data
readouts (hours, percentages, IDs, timestamps, counts). Each is exposed as a CSS variable
(`--font-display`, `--font-body`, `--font-mono`) set on `<html>`/`<body>` and referenced from
`globals.css`.

**Theme tokens.** Light values live on bare `:root`; dark values are defined twice — once under
`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` for the OS-driven case, and
again under `:root[data-theme="dark"]` for an explicit user choice — so light/dark/**system** all
work. The palette: brand red (`--red`/`--red-press`/`--red-fg`), warm-neutral surfaces (`--canvas`/
`--surface`/`--surface-2`/`--ink`/`--muted`/`--hair`), a cool steel secondary (`--steel`/
`--steel-soft`), and the M4 attendance-status colors (`--present`/`--excused`/`--optional`/
`--absent`, each with a `-fg` pair). Older `--color-*` aliases (`--color-brand`, `--color-present`,
etc.) still resolve to these so pre-M5 pages pick up the palette without individual edits.

**Theme toggle.** `ThemeToggle.tsx` in the nav cycles light/dark/system, sets/removes `data-theme`
on `<html>`, and persists the choice to `localStorage`. A small inline script in `layout.tsx`'s
`<head>` applies the stored value before paint, so there's no flash of the wrong theme.

**Component classes.** Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn.icon`
for icon-only actions, `.btn.danger` for a subtler destructive row-action), `.card`/`.card-head`,
`.tablewrap`/`.table`/`.toolbar`/`.search` (sticky header, row hover, an `overflow-x-auto` wrapper
for wide tables on narrow viewports), `.pill`/`.badge` (`.role`, `.admin`, `.on`/`.off`, and the
attendance `.status-*` variants), `.stat` (a big mono number with an optional `.bar` goal meter),
`.eyebrow` (small uppercase label), and form controls (`.label`, `.field`, `.input`). An `<Icon
name=… />` component (`src/components/Icon.tsx`) provides a small inline-SVG icon set (edit, trash,
plus, search, check, x, calendar, clock, users, chevron) — no external icon library.

**Signature elements.** The **pit board** (`.pit`/`.pit-row`, used by the dashboard's "in the shop"
list and the kiosk's on-the-clock column) shows an index, name, and a live mono clock-in duration
via `.clock`. Mono readouts (`.mono`, tabular-nums) are used everywhere a number should feel like an
instrument reading — hours, percentages, IDs, durations. The **hazard stripe** (`.hazard`, a
diagonal red/ink repeating gradient) marks the top of the app shell and the kiosk. The kiosk board
(`/kiosk`) is intentionally hardcoded dark regardless of theme — it's a always-on shop tablet, not a
themed page.

**Consistency conventions.** Every interactive control gets a visible `:focus-visible` outline
(defined once in `globals.css`, so new controls inherit it automatically). All animation respects
`prefers-reduced-motion: reduce` (a global guard collapses animation/transition durations to
~instant). Buttons that trigger a fetch disable themselves and swap their label while the request is
in flight (`Saving…`, `Deleting…`, etc.) so a slow network can't produce a duplicate submit. Empty
lists use active-voice copy that names the next action ("No members yet — add your first above")
rather than a blank table or a terse "None." Save/delete feedback uses the same inline
`role="status"`/`role="alert"` pattern across every form and row action.

**Admin.** `/admin` is a card-grid hub (admin-gated) linking every admin area with live counts —
People, Teams, Periods, Meetings, Build days, Sessions, Flagged sessions, Kiosk devices, Requests,
Settings. Every model in the schema has full create/read/update/delete reachable from the hub
(person, team, period, meeting, build_day, session, kiosk_device, plus read/update for app_setting
and the requests review queues) — see the CRUD gap table in
`docs/plans/2026-08-12-m5-ui-and-crud.md` for what M5 closed.

Pages are built from semantic HTML (`<main>`, `<table>`, `<form>`, `<label>`, headings) styled with
Tailwind utility classes plus the component classes above. Reach for the existing component classes
and utilities before adding new bespoke CSS.

### Why two Supabase URLs

`NEXT_PUBLIC_SUPABASE_URL` (`127.0.0.1:54321`) is what your **browser** reaches.
`SUPABASE_INTERNAL_URL` (`host.docker.internal:54321`) is what **server code inside the container**
reaches, because the Supabase stack runs as sibling containers. Server code must always go through
`serverSupabaseUrl()` in `src/lib/supabase-url.ts`. In production only the public URL is set.

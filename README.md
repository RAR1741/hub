# Team Hub

**The team-operations app for an FRC team, built by one.** Team Hub replaces the spreadsheet
pile and the grab-bag of disconnected tools (sign-in sheets, group chats, shared drives, sticky
notes on the CNC) with one app that runs attendance, roster, events, and the shop floor. Built by
and for **FRC Team 1741, Red Alert Robotics** — live in production for the team today.

## Highlights

**Attendance & hours**
- Kiosk sign-in/out board with a live who's-here view and an hours leaderboard
- Forgotten sessions auto-close overnight — nobody racks up phantom hours
- Self-service excusal requests, and season-hours goal progress students can watch climb

**Roster & people**
- Role-scoped roster and rich member profiles, with badges/credentials tracked per person
- Guardians (including shared guardians across siblings) live on the roster, not in a spreadsheet
- CSV roster import for bulk onboarding, duplicate-person merge to keep the roster clean, and
  admin masquerade for support

**Teams & events**
- Sub-teams with join/apply flows; events with sign-up and check-in
- A generic sign-up **forms engine** for anything from parent nights to competition carpools
- Printable door rosters for check-in tables

**Parts & shop**
- A public, TV-ready manufacturing-status board for the shop floor
- Project/part numbering with assemblies, plus drawing and mentor-approval gates before a part
  gets cut
- An Onshape CAD side-panel right next to the part it documents

**Integrations**
- Google Calendar sync, Google Drive/Workspace group sync
- Slack reminders and health alerts, FIRST (YPP) roster sync
- Email one-time-code sign-in — no password to manage

**Built for real use**
- Three sign-in paths: email code, student ID, or Google
- Light/dark theme and a live activity indicator
- Hours, attendance, and dietary CSV reports for banquets, events, and grant paperwork
- Nightly encrypted database backups

## Documentation

- **Feature catalog**: [docs/features.md](docs/features.md)
- **Feature deep-dives**: [docs/features/](docs/features/) — parts & shop, events & forms,
  FIRST roster sync, Slack integration, Drive group sync, guardians, badges, merge duplicate
  people, excusal requests, CSV roster import, reports export
- **Setup & integration runbooks**: [docs/setup/](docs/setup/)
- **Dev notes** (environment gotchas): [docs/dev-notes.md](docs/dev-notes.md)
- **UI & design system**: [docs/design/ui-system.md](docs/design/ui-system.md)
- **v1 spec**: [docs/superpowers/specs/2026-08-10-v1-design.md](docs/superpowers/specs/2026-08-10-v1-design.md)
  and **roadmap**: [docs/superpowers/plans/2026-08-10-v1-milestones.md](docs/superpowers/plans/2026-08-10-v1-milestones.md)
- **Research**: [docs/research/](docs/research/)

## Development

**Host requirements: Docker Desktop, a browser. Nothing else** — Node, npm, the Supabase CLI,
and psql all live inside the dev container.

### Quick start — one command

From the repo root:

    docker compose up

That builds the dev container and runs [`scripts/dev-up.sh`](scripts/dev-up.sh) inside it, which
installs npm deps (first run only), starts local Supabase (sibling containers), and starts the
Next.js dev server — all together, with logs streaming. Add `-d` to run it in the background.

- App: http://localhost:3000 · Supabase Studio: http://localhost:54323 (offset-0 ports for the
  main checkout — each git worktree gets its own offset-derived ports, printed when the stack
  starts; see [docs/dev-notes.md](docs/dev-notes.md))
- `docker compose down` stops **both** the app container and local Supabase (the startup script
  traps the shutdown signal and runs `supabase stop`; your DB data is preserved across restarts).
- First run needs `.env.local` — `cp .env.example .env.local` and fill in the keys. The committed
  local Supabase keys are stable demo JWTs, so the checked-in `.env.local` values just work.

### Running one-off commands

**`./dev` helper** (host shell): `./dev npm run test`, `./dev npm run db:psql`, `./dev bash` for
an interactive shell. It joins the same stack as `docker compose up` — starting it if needed —
so it's the one entrypoint for both bringing the stack up and running one-off commands.

Tests & checks: `./dev npm run test`, `./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run build`.
Database: `./dev npm run db:reset` (re-apply migrations + seed), `./dev npm run db:psql` (SQL shell),
`./dev npm run db:stop`.

Run `git` on the **host**, not through `./dev` — the container has no git credentials.

Environment gotchas (e.g. why there are two Supabase URLs) live in [docs/dev-notes.md](docs/dev-notes.md).

## Tech stack

Next.js (App Router) · Supabase/Postgres · Vercel · Playwright

## Contributing

Work happens in isolated git worktrees — `scripts/new-worktree.sh <branch-name>` sets one up
with its own Docker Compose stack and Supabase instance. See [AGENTS.md](AGENTS.md) for the full
workflow. `master` auto-deploys to production on merge.

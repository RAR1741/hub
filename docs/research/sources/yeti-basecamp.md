# yeti-basecamp — Source Survey

**Repo:** https://github.com/yeti-robotics/basecamp (FRC 3506 YETI Robotics)
**Surveyed at commit:** `78ad464c96e8370766cfba8cbf561c017b1d02cd`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/yeti-robotics/basecamp/blob/78ad464c96e8370766cfba8cbf561c017b1d02cd/<path>`

## Purpose

Basecamp is the intended web dashboard companion to Yeti Robotics' Discord bot, meant to replace Discord slash commands with a browser UI for administrators, mentors, and students to manage attendance hours, outreach hours, and "other things within its reach" (`README.md`). **As surveyed, this is a bare project scaffold, not a working application.** It is a freshly `create-turbo`'d monorepo with the stock Next.js/NestJS starter templates checked in unmodified — there is no attendance model, no auth, no Discord integration code, and no database schema yet. The repo is included here because it documents a team's *intended* architecture for exactly the kind of team-ops tool this research effort is surveying, even though no comparable features exist to catalog yet.

## Stack

- **Monorepo tooling:** Turborepo (`turbo.json`) + pnpm workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`), Node.js 20+/pnpm 10+ per `README.md`.
- **Frontend (`apps/dashboard`):** Next.js 16, React 19, TypeScript, Tailwind CSS — all stock `create-next-app` output. `apps/dashboard/app/page.tsx` is still the unedited Turborepo demo page (Vercel deploy button, "Get started by editing `apps/web/app/page.tsx`" placeholder text referencing a path that doesn't even exist in this repo).
- **Backend (`apps/api`):** NestJS, TypeScript — stock `nest new` output. `apps/api/src/app.controller.ts` / `app.service.ts` are the default "Hello World" controller/service; `README.md` labels this app "*(coming soon)*".
- **Database:** PostgreSQL 17, declared only as a bare `docker-compose.yaml` service (`basecamp-postgres`) and a `DATABASE_URL` in `.env.example`; `README.md` labels this "*(coming soon)*" too. No ORM, no migrations, no schema files anywhere in the repo.
- **Shared packages:** `packages/ui` (shared React components, currently just the turborepo starter `Button`), `packages/eslint-config`, `packages/typescript-config` — all default turborepo-generated scaffolding.
- **Lint/format:** biome.js (`pnpm lint`, `pnpm format` per `README.md`), plus per-app `eslint.config.mjs`/`.js`.
- **License:** none — `README.md` states "Private repository. All rights reserved." `apps/api/package.json` sets `"license": "UNLICENSED"`. Flag: no code or design here should be reused verbatim; treat as reference-only for the architecture idea.
- **Deployment/hosting:** No CI config, no Dockerfile for the apps themselves (only Postgres is containerized), no deploy scripts. Nothing configured yet.

## Auth & Roles

Not implemented. No auth library, session handling, or role model exists anywhere in `apps/dashboard` or `apps/api`. The README's stated user roles (administrators, mentors, students) are aspirational, not encoded in code.

## Data Model

None. No Prisma/Drizzle/TypeORM schema, no SQL migration files, no model/entity classes. The only trace of the planned database is the `basecamp`/`basecamp`/`basecamp` Postgres container in `docker-compose.yaml` and the matching `DATABASE_URL` in `.env.example`.

## Features

None of the README's described features (attendance hours, outreach hours, Discord-bot management UI) are implemented in this commit. The entire user-facing surface is the unmodified framework starters:

- **Next.js starter homepage** — Turborepo/Vercel demo content (logo, "Deploy now" button linking to Vercel's own clone-template flow, a "Read our docs" link to turborepo.dev, and an `Open alert` demo button from the shared `packages/ui` `Button` component). `apps/dashboard/app/page.tsx`, `apps/dashboard/app/page.module.css`, `apps/dashboard/app/layout.tsx`.
- **NestJS starter endpoint** — a single `GET /` returning the default "Hello World!" string. `apps/api/src/app.controller.ts`, `apps/api/src/app.service.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`.
- **Postgres container** — a plain `docker-compose.yaml` Postgres 17 service with a named volume; nothing connects to it yet. `docker-compose.yaml`, `.env.example`.

Not present (i.e., everything the survey would normally catalog): attendance tracking, outreach-hours tracking, Discord bot integration/commands, any admin/mentor/student views, any API routes beyond the default, any persistence layer.

## Integrations

None implemented. The README's premise is that Basecamp is a companion dashboard to an existing "Yeti Robotics official Discord bot," but no Discord API client, webhook, bot token config, or shared-schema reference to that bot appears in this repo at this commit.

## Notable Implementation Details

- **Single commit, brand-new repo.** `git log` shows this is effectively day-one of the project (latest/only substantive commit `78ad464`, 2026-07-21). Treat this survey as a snapshot of intent, not of a working tool — re-check for a later commit before relying on any details beyond the stack choice.
- **Starter content left unedited.** The dashboard homepage still links to Vercel's own "Deploy now" template-clone flow and reads "Get started by editing `apps/web/app/page.tsx`" — a path that doesn't exist in this repo (the app is at `apps/dashboard`), confirming the starter was scaffolded and not yet touched.
- **"Coming soon" is explicit in the README** for both the NestJS API and the Postgres-backed data layer, matching what the code shows: the API app has no modules beyond the default, and nothing queries Postgres.
- **Architecture signal worth noting for FRC 1741's own hub:** the intended design is a Next.js dashboard + separate NestJS API acting as a middleman to a Discord bot, backed by Postgres — a three-tier split rather than a single full-stack Next.js app talking directly to its own DB. Worth a light comparative note if/when this project produces real features, but nothing here yet to model against.

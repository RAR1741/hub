# RAR1741/tracking — Source Survey

**Repo:** https://github.com/RAR1741/tracking (FRC 1741, Red Alert Robotics)
**Surveyed at commit:** `89bc8110b27916313c12768131f33be3893ab503`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/RAR1741/tracking/blob/89bc8110b27916313c12768131f33be3893ab503/<path>`

## Purpose

`tracking` is a self-hosted web application built by FRC Team 1741 (Red Alert Robotics) intended to replace the team's spreadsheet-based member sign-in process. Its stated goal (README, `docs/Home.md`) is to serve students, mentors, parents, and team administrators with member sign-in/time tracking, training and "learnings management" (areas trained, areas pending training, coordinating mentor per training), badges for completing requirements, and robot battery tracking. Important caveat for cataloging: at the surveyed commit the repository is an early-stage scaffold — none of those domain features exist in code. What is implemented is the foundation: a React Router 7 SSR application with email/password authentication, a role-and-permission (RBAC) model, a user administration UI for assigning roles/permissions, and a permission-gated navigation shell. The domain tracking features described in the README and wiki docs are aspirational/planned, not present.

## Stack

- **Language:** TypeScript (ESM, `"type": "module"`), Node.js 22 in containers (Node 20 in CI).
- **Framework:** React 19 + React Router 7 in full-stack SSR mode (`react-router.config.ts` sets `ssr: true`), served by a custom Express 5 server (`server.js`, `server/app.ts`). File-system routing via `@react-router/fs-routes` `flatRoutes` (`app/routes.ts`).
- **Database:** PostgreSQL 17 (`docker-compose.yml`), accessed through Drizzle ORM (`drizzle-orm` + `postgres` driver) with `drizzle-kit` migrations (`drizzle/`, `drizzle.config.ts`).
- **Key libraries:** `better-auth` (authentication, incl. `better-auth/react` client and `better-auth/node` handler), `drizzle-orm`/`drizzle-kit`, `express`, `compression`, `morgan`, `isbot`, `node:async_hooks` `AsyncLocalStorage`.
- **Frontend approach:** Server-rendered React components with React Router loaders/actions and progressively-enhanced `<Form>` posts; Tailwind CSS 4 via `@tailwindcss/vite`, with a custom RAR brand theme in `app/app.css` (`--color-rar-red: #ee1d23`, etc.) and dark-mode variants throughout. Inter font loaded from Google Fonts (`app/root.tsx`). No component library, no client-side state manager.
- **Tooling:** Vite 6, ESLint 9 + typescript-eslint + react/react-hooks/react-router plugins (`eslint.config.js`), Prettier, Husky + lint-staged (`.husky/pre-commit`), GitHub Actions lint + typecheck (`.github/workflows/lint.yml`).
- **License:** No LICENSE file is present in the repository (`package.json` has no `license` field and is marked `"private": true`).
- **Deployment/hosting:** Multiple models coexist. (1) Heroku-style PaaS via `Procfile` (`release: npm run db:migrate:prod`, `web: npm run start`). (2) Container image via multi-stage `Dockerfile.prod` (dev deps → prod deps → build → runtime, `CMD npm run start`). (3) Local/dev via `docker-compose.yml` + VS Code Dev Container (`Dockerfile`, `.devcontainer/devcontainer.json`, which runs `npm install; npm run dev` on start and forwards ports 3000/5432/5173/24678). `.env.example` points `AUTH_URL` at `https://tracking.redalert1741.org/`, indicating a team-hosted production deployment.

## Auth & Roles

- **Sign-in:** Email + password only, via Better Auth (`auth.ts`: `emailAndPassword.enabled = true`). Better Auth's HTTP handler is mounted by Express at `/api/auth/*splat` (`server/app.ts`). Sign-up/sign-in happen client-side through `better-auth/react` (`app/lib/auth-client.ts`, `app/components/auth-form.tsx`). `requireEmailVerification` is `false` with a `// TODO: Enable this in production` comment. Password minimum length 6 is enforced only as an HTML `minLength` attribute. No OAuth providers, no magic links, no 2FA, no password reset.
- **Sessions:** Cookie-based, stored in the `session` table; `expiresIn` 7 days, `updateAge` 1 day. `trustedOrigins` and `crossSubDomainCookies` are enabled only in development.
- **Authorization model:** Custom RBAC layered on top of Better Auth. A user gets an effective permission set = (permissions of all assigned roles) ∪ (directly assigned user permissions), computed in `getUserWithRolesAndPermissions` (`app/lib/user-permissions.ts`).
- **Roles** (seeded in `database/seed.ts`): `ADMIN` (all permissions), `MENTOR`, `STUDENT_ADMIN`, `STUDENT`, `PARENT`, `GUEST`.
- **Permissions** (21, seeded as `id === name`, `database/seed.ts`): `user:create|read|update|delete|assign_roles|assign_permissions`, `role:create|read|update|delete`, `permission:create|read|update|delete`, `content:create|read|update|delete`, `student:progress_view`, `student:progress_update`, `child:progress_view`, `system:admin`.
- **Enforcement:** Server-side in route loaders/actions. `createAuthContextFromSession` + `requirePermission` / `requireAnyPermission` / `requireAuth` (`app/lib/auth-utils.ts`) throw a `302` `Response` redirecting to `/auth?mode=signin&message=...` when unauthenticated or unauthorized. `createPermissionChecker` (`app/lib/permissions.ts`) exposes `can` / `canAny` / `canAll` plus helpers `canManageUsers`, `canCreateContent`, `isAdmin`. Permissions are also resolved in the root loader to drive nav visibility (`app/root.tsx`).
- **Bootstrapping note:** Sign-up assigns no role, and there is no in-app path to grant the first `system:admin` — initial admin assignment requires direct database manipulation.

## Data Model

Defined in `database/schema.ts`; migrations in `drizzle/0000`–`0002`.

- **`user`** — `id` (text PK, Better Auth generated), `name`, `email` (unique), `emailVerified`, `image`, timestamps.
- **`session`** — belongs to `user` (cascade delete); `token` (unique), `expiresAt`, `ipAddress`, `userAgent`.
- **`account`** — belongs to `user` (cascade); Better Auth credential/provider record holding `providerId`, `accountId`, `password` hash, OAuth tokens/scope/`idToken`.
- **`verification`** — `identifier`/`value`/`expiresAt` token store for email verification flows.
- **`role`** — `id` (text, e.g. `"admin"`), `name` (unique), `description`, timestamps.
- **`permission`** — `id` (text, e.g. `"user:update"`), `name` (unique), `description`, timestamps.
- **`role_permission`** — join table, composite PK `(roleId, permissionId)`, both cascade-delete.
- **`user_role`** — join table, composite PK `(userId, roleId)`, plus audit fields `assignedAt` and `assignedBy` (self-FK to `user`).
- **`user_permission`** — direct user→permission grants that bypass roles; composite PK `(userId, permissionId)` plus `assignedAt`/`assignedBy`.
- **`guestBook`** — `id` (identity), `name`, `email` (unique); a leftover from the React Router starter template, unrelated to the domain.

Relationships: `user` ↔ `role` many-to-many via `user_role`; `role` ↔ `permission` many-to-many via `role_permission`; `user` ↔ `permission` many-to-many via `user_permission`. No entities exist yet for members, sign-in/out events, trainings, badges, or batteries.

## Features

- **Sign up (email/password)** — Creates an account with name, email, and password via the Better Auth client; client-side validation and inline error display, then redirect to `/`. — `app/routes/auth.tsx`, `app/components/auth-form.tsx`, `app/lib/auth-client.ts`, `auth.ts`
- **Sign in (email/password)** — Same form component in `signin` mode; the page mode is driven by the `?mode=signin|signup` query param, with an invalid mode redirecting to `signin`. — `app/routes/auth.tsx`, `app/components/auth-form.tsx`
- **Flash message on the auth page** — A `?message=` query param renders a floating banner, used by the permission guards to explain why the user was redirected ("Please sign in to continue" / "You don't have permission to access that page"). — `app/routes/auth.tsx`, `app/lib/auth-utils.ts`
- **Sign out** — Two paths: a header button calling the Better Auth client `signOut()`, and a server-side POST action route that proxies to `/api/auth/sign-out`, forwards the returned `Set-Cookie` headers, and falls back to manually expiring `better-auth.session_token`/`better-auth.csrf_token` on error. — `app/routes/auth.signout.tsx`, `app/components/header.tsx`, `app/welcome/welcome.tsx`
- **Session-aware branded header with permission-gated navigation** — Sticky RAR-red header with logo; shows Home always when signed in, `Users` only if the viewer has any of `user:update`/`user:assign_roles`/`user:assign_permissions`, `Admin` only if the viewer has `system:admin`, plus the display name and Sign Out / Sign In. Permissions are computed in the root loader server-side. — `app/root.tsx`, `app/components/header.tsx`, `app/lib/permissions.ts`
- **Home / landing page** — Shows the React Router template hero, an auth-status card (welcome + name/email + sign out, or Sign In / Sign Up links), and a conditional "Admin Tools → Manage Users" card gated on `user:update`. — `app/routes/_index.tsx`, `app/welcome/welcome.tsx`
- **Guest book** — Template-derived form on the home page that inserts a name/email into the `guestBook` table and lists existing entries; unique-email violations surface a generic "Error adding to guest book". Not part of the team-tracking domain. — `app/routes/_index.tsx` (`action`/`loader`), `app/welcome/welcome.tsx`, `database/schema.ts`
- **User list (admin)** — Table of all users showing name, email, a Verified/Unverified badge, creation date, and an Edit link. Requires `user:update`. — `app/routes/users.tsx`
- **Edit user details (admin)** — Form to update a user's `name` and `email` (sets `updatedAt`); success/error banners. Requires `user:update`. — `app/routes/users.$userId.edit.tsx` (`updateUser` action), `database/schema.ts`
- **Assign / remove roles (admin)** — Lists a user's current roles with descriptions and Remove buttons, plus a dropdown of not-yet-assigned roles to assign. Requires `user:update`. — `app/routes/users.$userId.edit.tsx` (`assignRole`/`removeRole`), `app/lib/user-permissions.ts`
- **Assign / remove direct permissions (admin)** — Same pattern for per-user permission grants that bypass roles, with a dropdown filtered to permissions the user doesn't already hold directly. Requires `user:update`. — `app/routes/users.$userId.edit.tsx` (`assignPermission`/`removePermission`), `app/lib/user-permissions.ts`
- **Effective permissions summary (admin)** — Scrollable, sorted read-only list of the union of role-derived and direct permissions for the user being edited. — `app/routes/users.$userId.edit.tsx`, `app/lib/user-permissions.ts` (`getUserWithRolesAndPermissions`)
- **Admin dashboard** — Route gated on `system:admin` rendering three static informational cards ("System Settings", "User Management", "System Logs"). The cards are placeholders — they contain no links or functionality. — `app/routes/admin.tsx`
- **Error boundary page** — Renders a 404 or generic error page (with stack trace in dev only) inside the standard header shell. — `app/root.tsx` (`ErrorBoundary`)
- **Dark mode** — Automatic light/dark theming across all pages via Tailwind `dark:` variants and `prefers-color-scheme`; no user-facing toggle. — `app/app.css`, all route/component files
- **Role & permission seeding (operator CLI)** — `npm run db:seed` idempotently inserts all permissions, roles, and role→permission links. — `scripts/seed-roles.ts`, `database/seed.ts`, `package.json`

Not implemented anywhere in the codebase despite being described in `README.md`/`docs/Home.md`: member check-in/kiosk flow, time-signed-in tracking, training/learnings management, trained-area tracking, coordinating-mentor assignment, badges, robot battery tracking, reports, data export, and notifications.

## Integrations

- **Better Auth** (`better-auth`) — the authentication system itself; Drizzle adapter for storage, Node handler mounted in Express, React client for the browser. — `auth.ts`, `server/app.ts`, `app/lib/auth-client.ts`
- **Google Fonts** — `preconnect` + stylesheet link for the Inter font family. — `app/root.tsx` (`links`)
- **GitHub Actions → GitHub Wiki sync** — On pushes to `master` that touch `docs/**`, the workflow clones the repo's `.wiki.git`, replaces its contents with `docs/`, and pushes, so `docs/` is the source of truth for the project wiki. — `.github/workflows/update_wiki.yml`
- **GitHub Actions CI** — Lint (`eslint --max-warnings 0`) and typecheck on PRs/pushes to `master`. — `.github/workflows/lint.yml`
- **GitHub Copilot** — `.github/CODEOWNERS` assigns `@github-copilot[bot]` as owner of all files; the Copilot Chat extension is preinstalled in the dev container. — `.github/CODEOWNERS`, `.devcontainer/devcontainer.json`

No email/SMTP provider, transactional-email service, OAuth/SSO provider, Google Sheets, Slack, SMS, payment, barcode/RFID scanner, or FRC/FIRST API integration is present.

## Notable Implementation Details

- **Per-request DB injection via AsyncLocalStorage.** `database/context.ts` exports a `DatabaseContext` `AsyncLocalStorage` store; Express wraps every request in `DatabaseContext.run(db, next)` (`server/app.ts`), and application code calls the bare `database()` helper, which throws `"DatabaseContext not set"` outside a request. Any re-implementation must preserve this or the loaders/actions will fail. `vite.config.ts` marks `node:async_hooks` external for the client build.
- **A second, separate Postgres connection exists solely for auth.** `auth.ts` creates its own `postgres()` client and Drizzle instance with the explanatory comment that auth "needs to work outside of the AsyncLocalStorage context." So the app opens two connection pools.
- **Middleware ordering is load-bearing.** `app.all("/api/auth/*splat", toNodeHandler(auth))` must be registered *before* `express.json()` (explicitly commented in `server/app.ts`), and uses the Express 5 `*splat` wildcard syntax.
- **Authorization failures are redirects, not 403s.** `requirePermission` throws a hand-built `302` `Response` toward `/auth?mode=signin&message=...` even for authenticated-but-unauthorized users (`app/lib/auth-utils.ts`), so an authorization denial looks like a sign-in prompt.
- **Permission checks are read-amplifying.** `hasPermission`, `hasAnyPermission`, and `hasAllPermissions` each call `getUserWithRolesAndPermissions`, which issues up to four separate queries (user, roles, direct permissions, role permissions) with no caching or memoization — the root loader plus a route guard can therefore run this several times per request. Root-loader and index-loader permission checks are wrapped in `try/catch` that silently defaults to `false`.
- **Idempotent seeding.** Every seed insert uses `onConflictDoNothing()`, so `npm run db:seed` is safe to re-run; permission rows use the permission string as both `id` and `name`, and descriptions are auto-generated from the string (`database/seed.ts`).
- **Audit columns exist but are unused.** `user_role.assignedBy` / `user_permission.assignedBy` are supported by `assignRoleToUser`/`assignPermissionToUser` as an optional third argument, but the edit-user action never passes the acting admin's id (`app/routes/users.$userId.edit.tsx`).
- **Dual-mode Express entry point.** `server.js` boots Vite in middleware mode and `ssrLoadModule("./server/app.ts")` when `NODE_ENV=development` (with stack-trace fixing), and otherwise imports the prebuilt `./build/server/index.js` with `compression`, `morgan`, and long-cache static asset serving.
- **`.well-known` short-circuiting.** `server/app.ts` explicitly 404s `/.well-known/appspecific/com.chrome.devtools.json` and all other `/.well-known/*` paths before the React Router handler, to keep Chrome DevTools probes out of the route matcher.
- **Production TLS is permissive.** Both `auth.ts` and `server/app.ts` connect with `ssl: { rejectUnauthorized: false }` when `NODE_ENV=production`; `drizzle.config.ts` separately appends `sslmode=require` to the migration URL if not already specified — a pattern typical of PaaS-managed Postgres with self-signed certs.
- **Migrations run on release, not boot.** The `Procfile` `release` phase runs `drizzle-kit migrate` without `dotenv`, so production expects `DATABASE_URL` to be injected by the platform; the dev scripts wrap everything in `dotenv --`.
- **Dev container assumptions.** `docker-compose.yml` runs Postgres with `POSTGRES_HOST_AUTH_METHOD: trust` (no password) and bind-mounts the repo; the app container's `Dockerfile` ends in `tail -f /dev/null` so VS Code drives the process. Vite uses `usePolling: true` (1s interval) for file watching inside the container and a dedicated HMR port 24678.
- **Type-safety gaps to watch.** `app/routes/admin.tsx`, `app/routes/users.tsx`, and `app/routes/users.$userId.edit.tsx` declare hand-written `LoaderArgs`/`ActionArgs` interfaces instead of the generated `Route.*` types used elsewhere; form fields are read with `as string` casts without validation.
- **No background jobs, scheduled tasks, cron, queues, or hardware dependencies exist** in the codebase, and there are no automated tests or test framework of any kind.

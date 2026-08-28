# Tailwind UI Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Give Team Hub a clean, modern, cohesive, easy-to-use look with Tailwind CSS v4 — a proper app shell, readable typography, a consistent color system with a Red Alert Robotics red accent, comfortable spacing, accessible focus states, and a touch-friendly kiosk — WITHOUT changing any behavior, text content, or breaking the test/E2E suites.

**Architecture:** Tailwind CSS v4 (CSS-first, no `tailwind.config.js`) wired through `@tailwindcss/postcss`. A small design system lives in `src/app/globals.css` (`@theme` tokens + a few component classes via `@layer components`) and a set of shared presentational components in `src/components/ui/`. Every page/component is restyled by adding `className`s to the EXISTING semantic markup — structure, headings, labels, and button text are preserved verbatim.

**Tech stack:** Next.js 16.3 (App Router), Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/postcss`), no other new deps. Per this Next version's docs (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`): install `-D tailwindcss @tailwindcss/postcss`, add `postcss.config.mjs` with the `@tailwindcss/postcss` plugin, `@import "tailwindcss";` at the top of `globals.css`.

## Global Constraints (binding for every task)

- **This plan REVERSES the earlier "no CSS frameworks" rule** — Tailwind is now required and expected. That reversal applies ONLY to this plan.
- **Do not change behavior or break tests.** The unit suite (190 tests) and the 8 Playwright E2E specs MUST stay green. The E2E specs assert on: nav link text "Kiosk"/"Leaderboard"; `getByRole("button", { name: "Sign in", exact: true })` on `/login`; `getByText(/signed in as/i)` on `/`; `getByRole("heading", { name: /Calendar/ })`; `getByRole("heading", { name: /Flagged sessions/ })`; the kiosk clock flow. **Preserve all visible text, heading text/levels, `<label>` associations, `role`/`aria`, form field names, and button labels.** Restyle by adding `className`; never rename/remove text or restructure the accessibility tree.
- Everything runs in the dev container via `./dev`. **Git runs on the HOST.** Push after every commit.
- After each task: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build` all green. Run `./dev npx playwright test` after any task that touches `/login`, `/`, `/calendar`, `/admin/sessions/flagged`, the nav, or the kiosk.
- Plain semantic HTML stays semantic — Tailwind classes decorate it. Keep `<main>`, `<table>`, `<form>`, `<label>`, `<nav>`, headings.
- Accessibility: visible focus rings (`focus-visible:`), sufficient contrast, `prefers-color-scheme` dark support via the token system, tap targets ≥ 44px on the kiosk.
- The dev server may need the restart recipe after new files: two separate detached execs (`docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "pkill -9 -f next-server"`; sleep 4; `... exec -d app bash -lc "cd /workspaces/hub && npm run dev > /tmp/nextdev.log 2>&1"`; poll to 200).

## Design direction

- **Color:** a neutral gray canvas with a single brand accent — Red Alert Robotics red (`--color-brand: oklch(0.55 0.20 25)` ≈ a strong red; provide `brand`, `brand-fg`, hover/active shades). Semantic status colors for attendance: present=green, excused=blue, optional=slate, absent=red/amber. Support light + dark via `@theme` + `prefers-color-scheme`.
- **Layout:** a max-width centered content column (`max-w-5xl`/`max-w-6xl`) with generous padding; a sticky top nav bar with the brand mark, primary links, and the signed-in identity/sign-out on the right; responsive (nav collapses gracefully on mobile).
- **Typography:** a clean sans stack, clear heading scale, readable body, muted secondary text.
- **Components:** cards/panels, styled tables (zebra rows, sticky header), buttons (primary/secondary/danger), inputs/selects/labels, badges/pills (roles, attendance status, flags), empty states. The kiosk gets large, high-contrast, touch-friendly name buttons.

## Task 1: Tailwind v4 setup + design tokens + app shell (layout + nav)

**Files:** `package.json` (+`tailwindcss`,`@tailwindcss/postcss` devDeps), `postcss.config.mjs` (create), `src/app/globals.css` (replace with `@import "tailwindcss"` + `@theme` tokens + base + component layer), `src/app/layout.tsx` (shell wrapper), `src/components/SiteNav.tsx` (restyle to a top nav bar — KEEP all link text + `hasRole` gating + the sign-out form).

- [ ] Install Tailwind v4 + `@tailwindcss/postcss`; add `postcss.config.mjs` (`export default { plugins: { "@tailwindcss/postcss": {} } }`).
- [ ] Replace `globals.css`: `@import "tailwindcss";` then an `@theme` block defining brand + neutral + status color tokens and font tokens; a base layer (body bg/text, sensible defaults, focus-visible ring); a small `@layer components` for `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.card`, `.input`, `.label`, `.badge`, `.table` reused across pages. Keep light/dark via `prefers-color-scheme`.
- [ ] Restyle `layout.tsx`: body gets the canvas bg/text + font; wrap `{children}` so pages sit in a centered, padded column below the nav. Do NOT drop the existing `<html>`/`<body>` or metadata.
- [ ] Restyle `SiteNav.tsx` into a sticky top bar: brand text/mark on the left, the existing links (Kiosk, Leaderboard, and the role-gated Flagged/Admin links — text unchanged) as nav items, identity + Sign out on the right. Preserve every `Link href`, the `hasRole` conditionals, and the sign-out form action.
- [ ] Verify: build green; `./dev npx playwright test` green (nav text + sign-in flow intact). Commit `feat(ui): tailwind v4 setup, design tokens, and app shell`.

## Task 2: Auth + dashboard — `/login`, `/` (home)

**Files:** `src/app/login/page.tsx` (+ any login form component), `src/app/page.tsx`, `src/components/WhosHere.tsx`.

- [ ] Restyle `/login`: a centered auth card — the Google mentor button, the student-ID field + **"Sign in"** button (keep `name="Sign in"` text EXACTLY, it's an E2E selector + `exact:true`), and the "request an account" affordance. Keep all labels/text.
- [ ] Restyle the dashboard `/`: hero/greeting, the current-period hours stat, the "In the shop" who's-here panel, and the guest-visible "Upcoming meetings" section — as cards. Keep "signed in as" text (E2E) and all section headings/text.
- [ ] `WhosHere.tsx`: style the live list as a panel with presence pills; keep the polling logic + the `role="status"`/heading text.
- [ ] Verify build + `./dev npx playwright test` (login + dashboard specs). Commit `feat(ui): restyle login and dashboard`.

## Task 3: Kiosk — `/kiosk`, `/kiosk/setup` (touch-first)

**Files:** `src/app/kiosk/page.tsx`, `src/app/kiosk/setup/page.tsx`, `src/components/KioskBoard.tsx`.

- [ ] Restyle the kiosk into a full-screen, high-contrast, touch-first board: a large "Sign in" grid of big name buttons and a "Who's here" column of big sign-out buttons, a prominent flash/toast area. Tap targets ≥ 44px, legible at a distance. Keep the button actions, the `personId` wiring, the flash `role="status"` text, and the clock endpoints untouched (E2E kiosk round-trip must pass).
- [ ] Restyle `/kiosk/setup` token form as a simple centered card.
- [ ] Verify build + `./dev npx playwright test` (kiosk spec). Commit `feat(ui): restyle kiosk board and setup`.

## Task 4: Roster + attendance views — `/people`, `/people/[id]`, `/leaderboard`, `/me/attendance`, `/calendar`

**Files:** `src/app/people/page.tsx`, `src/app/people/[id]/page.tsx`, `src/app/leaderboard/page.tsx`, `src/app/me/attendance/page.tsx`, `src/app/calendar/page.tsx`, `src/components/AttendanceGridActions.tsx`.

- [ ] Restyle the roster list + profile (cards, role/team badges, styled sessions/hours tables), the leaderboard (styled ranked table, period selector), and My Attendance (summary stat + per-date status list with colored status pills).
- [ ] Restyle the `/calendar` grid with Tailwind: keep the members×build-days table structure and the `data-status` attributes; map each status to a clear color via the token classes (present/excused/optional/absent), sticky header/first column, readable percentage column. Keep the `getByRole("heading", { name: /Calendar/ })` heading text. Style the cell actions.
- [ ] Verify build + `./dev npx playwright test` (calendar spec). Commit `feat(ui): restyle roster, leaderboard, my-attendance, and calendar grid`.

## Task 5: Admin pages + shared form components

**Files:** `src/app/admin/**/page.tsx` (people, people/[id], teams, teams/[id], periods, kiosk-devices, settings, sessions/flagged, requests) and the client form/manager components (`PersonForm`, `TeamForm`, `PeriodForm`, `ActivatePeriodButton`, `KioskDeviceManager`, `SettingsForm`, `SessionEditRow`, review-queue components).

- [ ] Restyle every admin page to the shared card + table + form system: consistent page headers, styled forms (inputs/labels/selects/buttons via the component classes), styled queues and the flagged-sessions editor. Keep the `getByRole("heading", { name: /Flagged sessions/ })` heading text and all form field labels/names, button text, and `confirm()` flows.
- [ ] Restyle the shared form components once so they look consistent everywhere they're used.
- [ ] Verify build + full `./dev npx playwright test` (all 8 specs) + `./dev npm run test`. Commit `feat(ui): restyle admin pages and shared forms`.

## Task 6: Polish pass + README

**Files:** any component; `README.md`.

- [ ] Cross-page consistency sweep: spacing rhythm, empty states, loading/disabled states, mobile responsiveness (nav + tables + kiosk), dark-mode check, focus-visible on every interactive element. Fix stragglers still using bare/unstyled markup.
- [ ] Note the Tailwind design system in `README.md` (where tokens + component classes live).
- [ ] Final: build + full E2E + unit all green; a quick browser pass on the main routes. Commit `feat(ui): consistency + responsiveness polish`.

## Self-review notes
- **Invariant preservation:** every task's verify step re-runs the affected E2E specs; Task 5/6 run the full suite. The binding text/role/label selectors are enumerated in Global Constraints.
- **Scope:** styling only — no behavior, data, route, or API changes. No new deps beyond Tailwind + its PostCSS plugin.
- **Deferred:** component-library extraction beyond `src/components/ui/` primitives; animations beyond simple transitions; a full mobile nav drawer if the responsive nav suffices.

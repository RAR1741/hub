# M5 — UI/UX Elevation + Admin CRUD Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Raise Team Hub from "workable" to a polished, distinctive "shop-floor control panel" look with better UX, and ensure **every model has full admin CRUD** (create/edit/delete) reachable from a coherent admin section.

**Architecture:** Tailwind v4 design system (already in place) is re-grounded to the approved direction: self-hosted display/body/mono fonts via `next/font`, a warm-neutral + Red Alert red + charcoal + steel palette across light/dark/system, and an elevated component-class layer (refined tables, cards, pills, mono stat readouts, the "pit board", a hazard-stripe accent, an inline-SVG icon set). Existing pages are restyled to it; the missing CRUD operations get new lib functions + `withRole` routes + admin pages, tied together by an Admin hub.

**Tech stack:** Next.js 16.3 (App Router, TS strict), Tailwind v4, `next/font` (self-hosted Google fonts — no runtime CDN), Vitest, Playwright. No other new deps.

## The visual source of truth

`docs/design/ui-direction-mockup.html` is the **approved** design language (open it; it has a light/dark/system toggle). Match its palette, type treatment, spacing, and the signature elements — the **pit board**, **mono data readouts** (tabular-nums), role/status **pills**, the **hazard stripe** accent, refined **data tables** with per-row edit/delete, and the bold always-dark **kiosk**. It uses system fonts as stand-ins; the real build uses the fonts named below.

## Global Constraints (binding for every task)

- **Do not break tests or behavior.** All Vitest unit tests and all Playwright E2E specs MUST stay green (new features add tests). The E2E specs assert these — preserve exactly: nav link text **"Kiosk"**/**"Leaderboard"**; `getByRole("button", { name: "Sign in", exact: true })` on `/login`; the Google button is NOT exactly "Sign in"; `getByText(/signed in as/i)` on `/`; `getByRole("heading", { name: /Calendar/ })`; `getByRole("heading", { name: /Flagged sessions/ })`; the kiosk clock flow (`personId` wiring, flash `role="status"`). Restyle by changing classes/markup wrappers; keep visible text, heading levels, `<label>` associations, roles/aria, form field names, and button labels. When adding CRUD, don't alter existing routes' contracts.
- **Fonts:** self-host via `next/font/google` (build-time, no runtime CDN — verify the API against `node_modules/next/dist/docs/` for this Next version): **Archivo** (display/headings), **Inter** (body/UI), **JetBrains Mono** (data readouts — hours, %, IDs, times, counts). Expose as CSS vars `--font-display`, `--font-body`, `--font-mono`.
- **Theme:** support **light + dark + system**. Tokens on bare `:root` (light), `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (dark), and `:root[data-theme="dark"]` (explicit). A **theme toggle** (light/dark/system) lives in the nav and persists to `localStorage`; a tiny inline script in `<head>` applies the stored choice before paint (no flash). `body` paints an explicit token background.
- Everything runs in the dev container via `./dev`. **Git runs on the HOST.** Push after every commit. TS strict.
- After each task: `./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run build` all green. Run `./dev npx playwright test` after any task touching `/login`, `/`, `/calendar`, `/admin/sessions/flagged`, the nav, or the kiosk. If Chromium is missing in the container, `./dev npx playwright install chromium` first.
- **Dev-server restart** (new route/page files don't reliably hot-reload): two separate detached execs — `docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "pkill -9 -f next-server"`; `sleep 4`; `docker compose -p team-hub -f .devcontainer/docker-compose.yml exec -d app bash -lc "cd /workspaces/hub && npm run dev > /tmp/nextdev.log 2>&1"`; poll `./dev bash -lc "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"` to 200.
- **Admin CRUD routes** are `withRole("admin", ...)` unless an existing pattern uses mentor+ (sessions/build-days/excusals are mentor+); match the model's existing gate. `[id]` routes use `type Ctx = { params: Promise<{ id: string }> }` + `await context.params`. Service-role `getDb()` only.

## CRUD gap summary (Tasks 4–5 close these)

| Model | Today | Add |
|---|---|---|
| person | create, edit (incl. active toggle) | **delete** (hard, confirm) |
| period | create, edit, activate | **delete** (guard/soft if it has sessions) |
| meeting | GCal sync only | **create / edit / delete** + a Meetings admin page |
| kiosk_device | create, delete | **rename (PATCH)** |
| build_day | create/edit/delete routes exist (calendar cells) | a **Build days admin page** (list + CRUD) |
| session | manual add + edit/delete on *flagged* screen | an **all-sessions** admin page (browse/edit/delete) |
| team, team_membership, excusal, app_setting, requests | already full/adequate | apply the new table/form treatment |

---

### Task 1: Elevated design system — fonts, tokens, components, app shell, theme toggle

**Files:** `package.json` (no new deps unless needed), `src/app/layout.tsx` (fonts + theme inline script), `src/app/globals.css` (re-ground tokens + component layer), `src/components/SiteNav.tsx` (refined topbar + brand + theme toggle), `src/components/ThemeToggle.tsx` (create), `src/components/Icon.tsx` (create — small inline-SVG set), and any shared style helpers.

- [ ] Wire `next/font/google` for Archivo, Inter, JetBrains Mono in `layout.tsx`; set the `--font-*` vars on `<html>`/`<body>`. Verify the `next/font` usage against this Next version's docs.
- [ ] Rebuild `globals.css` to the mockup: the token palette for light/dark/system (warm canvas `#F5F2EE`, red `#E01926`, charcoal ink, steel, statuses; dark equivalents), and a component layer matching the mockup — `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-danger`/`.btn.icon`, `.card`/`.card-head`, `.table` (toolbar, sticky header, hover, zebra-off), `.pill` (`.role`/`.admin`/`.on`/`.off` + attendance statuses), `.stat` mono readout, `.eyebrow`, `.pit`/`.pit-row`/`.clock`, `.hazard` stripe, `.status-strip`, form controls (`.input`/`.label`/`.field`). Keep the M4 status-color semantics (present/excused/optional/absent).
- [ ] `ThemeToggle.tsx`: light/dark/system control that sets/removes `data-theme` on `document.documentElement` and persists to `localStorage`; add the no-flash inline `<head>` script in `layout.tsx` that reads the stored value before paint.
- [ ] `Icon.tsx`: a tiny set of inline SVG icons (edit, delete/trash, plus, search, check, x, calendar, clock, users, chevron) as a `<Icon name=… />` component — no external icon lib.
- [ ] Restyle `SiteNav.tsx` into the refined sticky topbar: `1741` red monogram + "Team Hub" brand, hazard stripe, the existing links (text unchanged, incl. Kiosk/Leaderboard + role-gated Admin/Flagged), the theme toggle, and identity on the right. Preserve all `Link href`s and `hasRole` gating.
- [ ] Verify: build green; `./dev npx playwright test` green (nav text + flows intact). Commit `feat(ui): elevated design system — fonts, tokens, components, shell, theme toggle`.

### Task 2: Dashboard + kiosk (signature screens)

**Files:** `src/app/page.tsx`, `src/components/WhosHere.tsx`, `src/app/kiosk/page.tsx`, `src/app/kiosk/setup/page.tsx`, `src/components/KioskBoard.tsx`.

- [ ] Dashboard: the **pit board** (WhosHere as the styled board — index, name, subteam if available, live clock-in duration in mono via the existing `since` timestamps), the **hours stat** as a big mono readout with a goal bar, and **upcoming meetings** with a red *Required* tag for required days. Charcoal live-status strip up top. Keep the guest-visible meetings + "signed in as" text.
- [ ] Kiosk: the bold always-dark board — big tap-target name grid + on-the-clock column with mono durations; keep the clock-in/out handlers, `personId` wiring, and the flash `role="status"`. `/kiosk/setup` as a centered card.
- [ ] Verify build + `./dev npx playwright test` (kiosk + dashboard). Commit `feat(ui): dashboard pit board and bold kiosk`.

### Task 3: Roster, leaderboard, attendance, calendar, login

**Files:** `src/app/people/page.tsx`, `src/app/people/[id]/page.tsx`, `src/app/leaderboard/page.tsx`, `src/app/me/attendance/page.tsx`, `src/app/calendar/page.tsx`, `src/components/AttendanceGridActions.tsx`, `src/app/login/page.tsx` (+ its form components), `src/app/teams/page.tsx`, `src/components/JoinButtons.tsx`.

- [ ] Restyle the roster (data table with role/status pills, mono student IDs), profile (header + mono hours readouts + sessions table + attendance), leaderboard (ranked mono table), My Attendance (summary stat + status-pill per-date list), and the `/calendar` grid (keep `data-status` + `attendance-grid` scope; refined colored cells, sticky header/first column, mono %). Login as a centered card (keep exact "Sign in" button + Google button naming). Bring `/teams` + JoinButtons along.
- [ ] Preserve the `/Calendar/` heading + all E2E text. Verify build + `./dev npx playwright test`. Commit `feat(ui): restyle roster, leaderboard, attendance, calendar, login`.

### Task 4: Admin CRUD — new operations (libs + routes + tests)

**Files:** `src/lib/people.ts` (+`deletePerson`), `src/lib/periods.ts` (+`deletePeriod`), `src/lib/meetings.ts` (+`parseMeetingInput`/`createMeeting`/`updateMeeting`/`deleteMeeting`), `src/lib/kiosk.ts` (+`renameKioskDevice`), `src/lib/reports.ts` or a new `src/lib/sessions-admin.ts` (+`listSessionsForPeriod(personId?)`), plus routes: `src/app/api/admin/people/[id]/route.ts` (+DELETE), `src/app/api/admin/periods/[id]/route.ts` (+DELETE), `src/app/api/admin/meetings/route.ts` + `[id]/route.ts`, `src/app/api/admin/kiosk-devices/[id]/route.ts` (+PATCH). Tests: extend the relevant `*.test.ts`.

**Interfaces (TDD the pure parsers + the fn signatures):**
- `deletePerson(id, db?): {ok, status}` — 404 if missing; `person` FKs cascade (`session`/`team_membership` on delete cascade) — deletion is allowed; confirm cascade in the migration and note it.
- `deletePeriod(id, db?): {ok, status}` — 404 miss; **409 if the period has sessions** (don't silently delete history); the route surfaces a clear message.
- `parseMeetingInput(body): { gcalEventId?: null; title; startsAt; endsAt } | null` — PURE; title required, ISO datetimes, endsAt ≥ startsAt. `createMeeting`/`updateMeeting`/`deleteMeeting` (manual meetings have `gcal_event_id = null`; the GCal sync only upserts by non-null `gcal_event_id`, so it won't clobber manual ones — verify).
- `renameKioskDevice(id, name, db?): {ok, status}` — 404 miss.
- `listSessionsForPeriod(periodId, personId?, db?): (Session & { name })[]` — for the all-sessions admin view.

- [ ] TDD each pure parser (`parseMeetingInput` accept/reject cases). Implement libs + routes with the correct role gate (people/periods/meetings/kiosk = admin; keep sessions mentor+). Live authz checks (403/307) after restart.
- [ ] Verify build + `./dev npm run test` (new tests) + `./dev npx playwright test`. Commit `feat(admin): add delete/rename/meeting CRUD operations (libs, routes, tests)`.

### Task 5: Admin section — hub, new pages, restyle, wire the new CRUD

**Files:** `src/app/admin/page.tsx` (create — the hub), `src/app/admin/meetings/page.tsx` (create), `src/app/admin/build-days/page.tsx` (create), `src/app/admin/sessions/page.tsx` (create — all sessions), existing admin pages (`people`, `people/[id]`, `teams`, `teams/[id]`, `periods`, `kiosk-devices`, `settings`, `sessions/flagged`, `requests`), and their form/manager components (`PersonForm`, `TeamForm`, `PeriodForm`, `MeetingForm` (create), `BuildDayForm` (create), `KioskDeviceManager`, `SettingsForm`, `SessionEditRow`, review-queue components). Update `SiteNav.tsx` admin links to point at the hub.

- [ ] **Admin hub** (`/admin`): a card grid linking every admin area (People, Teams, Periods, Meetings, Build days, Sessions, Flagged, Kiosk devices, Requests, Settings) with live counts — the coherent entry point. Admin-gated (redirect `/`).
- [ ] Restyle every admin page + shared form to the new table/form system (the mockup's People screen is the template). Add the wired controls for the **new** operations: person **Delete** (confirm), period **Delete** (confirm + 409 handling), kiosk device **Rename**, and the new **Meetings** page (list + add/edit/delete, showing gcal-vs-manual source) and **Build days** page (list + add/edit kind/delete) and **all-Sessions** page (browse by period/member + edit/delete reusing `SessionEditRow`).
- [ ] Preserve `/Flagged sessions/` heading + all labels/gates. Verify build + full `./dev npx playwright test` + `./dev npm run test`. Commit `feat(admin): admin hub, meetings/build-days/sessions pages, and CRUD wiring`.

### Task 6: Polish, consistency, states, and docs

**Files:** any component; `README.md`; optionally a new E2E spec.

- [ ] Consistency sweep against the mockup: spacing rhythm, empty states ("No members yet — Add one" style, active-voice copy), disabled/loading states on submit buttons, toast/inline feedback on save/delete, focus-visible on every control, `prefers-reduced-motion`, mobile (nav, wide tables in `overflow-x-auto`, kiosk, calendar), and a full **dark-mode pass** on every screen. Fix stragglers.
- [ ] Add one Playwright spec exercising a **new admin CRUD** flow (e.g. create → edit → delete a meeting, or a period delete) via the seeded-mentor/admin session helper, so the new capability is covered.
- [ ] Update `README.md` design-system section (fonts, tokens, component classes, the pit board / mono-readout conventions, theme toggle). Final: build + full E2E + unit all green; a browser pass on the main routes.
- [ ] Commit `feat(ui): consistency, states, dark-mode, and docs`.

## Self-review notes
- **Invariant preservation:** every task re-runs the affected E2E; Tasks 5–6 run the full suite. Binding text/role/label selectors are enumerated in Global Constraints. New CRUD adds tests (Task 4) + an E2E flow (Task 6).
- **Scope:** visual elevation + the enumerated CRUD gaps + supporting admin pages/hub. No data-model changes except reads/writes for the new operations (which use existing tables; manual meetings use `gcal_event_id = null`). No new deps beyond `next/font` (bundled).
- **CRUD coverage after M5:** person C/R/U/**D**, team C/R/U/D, period C/R/U/**D**, session C/R/U/D (+ general admin view), meeting **C/R/U/D**, build_day C/R/U/D (+ page), excusal C/R/D, kiosk_device C/R/**U**/D, app_setting R/U, requests review. Every model editable from the admin hub.
- **Deferred:** sortable/paginated tables beyond basic; bulk actions; audit/history UI; a component-library extraction. Custom domain, roster import remain user tasks.

# Team Hub v1 — Milestone Roadmap

Spec: [docs/specs/2026-08-10-v1-design.md](../specs/2026-08-10-v1-design.md) (approved 2026-08-10).

v1 is delivered as four sequential plans; each produces working, testable software. Detailed task plans are written when the preceding milestone completes, so they reflect the real codebase rather than guesses.

**All local development happens inside a VS Code Dev Container** — Docker Desktop, VS Code, and a browser are the only things installed on a developer's machine. Every command in every milestone plan runs in that container.

| # | Milestone | Delivers | Plan |
|---|---|---|---|
| 1 | **Foundation & auth** | Dev container, Next.js + Supabase scaffold, core schema (person, account_request, kiosk_device, app_setting), RLS default-deny, student-ID sessions, mentor Google OAuth with allowlist + first-user-admin bootstrap, `getViewer()`/role enforcement, login page, CI | [2026-08-10-m1-foundation-auth.md](2026-08-10-m1-foundation-auth.md) |
| 2 | **Roster & teams** | Person CRUD + profiles, team tree + memberships + join modes + application queue, account-request review queue, admin people/teams/requests pages, guest-scoped roster views | *written after M1* |

**Carry-forwards from M1's final review (fold into the M2 plan):**
- **Normalize `person.email` to lowercase at every write site** (roster create/edit, CSV import) — the mentor OAuth allowlist matches on a lowercased email, so a mixed-case stored address would silently fail the match and drop a mentor to guest. Consider a DB-level guarantee (citext or a lowercase check/index) since M2 is where the write paths appear.
- **Input hardening on the public unauthenticated routes** (`/api/account-request`, `/api/auth/student`): runtime-validate `gradYear` (non-numeric currently 500s), cap string field lengths, and add basic rate limiting. Student IDs act as bearer credentials, so the login route especially wants throttling.
- **Add `middleware.ts` for server-side Supabase session refresh** — `getViewer()`'s cookie adapter is currently read-only (no-op `setAll`), so an expired-but-refreshable mentor token can't refresh server-side and the mentor is spuriously downgraded to guest until the browser client refreshes. Fail-safe direction (availability only), but worth fixing.
- **M1 completed 2026-08-10.** OAuth end-to-end remains unverified pending a Google Cloud OAuth client ID/secret — first real M2 verification step once credentials exist. The M1 code + config are ready; `supabase/config.toml` redirect URLs are set for `http://localhost:3000/auth/callback`.
| 3 | **Attendance core** | Periods (seasons), sessions with one-open-session invariant, kiosk page + device tokens, who's-here poll, hours totals + leaderboard + per-member detail, flagged-sessions screen, nightly sweep (pg_cron) | [2026-08-11-m3-attendance-core.md](2026-08-11-m3-attendance-core.md) |

**M3 completed 2026-08-11.** All 9 tasks implemented subagent-driven on master, per-task reviewed + whole-branch reviewed (APPROVE, no Critical/Important), CI green. Kiosk clock round-trip and the timezone-aware nightly sweep verified end-to-end (device-token round-trip; SQL sweep against a backdated session). Final-review polish applied in `d82921e` (updateSession 23505→409, session-edit empty-time guard, sweep `search_path` hardening, who's-here comment).

**Carry-forwards from M3's final review (fold into M4):**
- **M3 deferred minors:** flagged page hardcodes "18h" → read `max_shift_hours`; `src/app/page.tsx` computes one user's hours via a full `periodLeaderboard` (over-fetch); `KioskDeviceManager` create has no in-flight double-click guard; pure-parser test gaps (invalid-note rejection, cookie value with `=`, too-long period name).
- **setActivePeriod race:** add a `period(is_active) where is_active` partial unique index to make "one active period" a DB invariant (kills the non-transactional clear-then-set race).

**Carry-forwards from M2's final review (fold into M3, or M4/deploy where noted):**
- **Rate-limit client IP trust (M4/deploy):** `clientIp` in `src/lib/rate-limit.ts` uses the first `x-forwarded-for` hop, which is client-spoofable. When we deploy (M4), key the public-endpoint limiters on the platform-provided trusted client IP (e.g. Vercel's real-IP header) instead.
- **Team cycle display (follow-up):** `buildTeamTree` surfaces orphaned parents as roots but silently drops a deliberate `A→B→A` cycle (createable across two admin edits; the self-parent guard only blocks `A→A`). Data is intact — only the tree render hides it. If/when team editing gets heavier use, either detect cycles in `updateTeam` or surface unreachable nodes as roots.
- **Admin non-admin redirect (cosmetic):** admin pages `redirect("/login")` for a logged-in non-admin; consider redirecting to `/` (or a 403 view) instead so an already-signed-in student isn't bounced to a login page.
- **Direct unit tests for `createPerson`/`updatePerson`** 409/404 branches (currently only exercised via routes/typecheck) — cheap insurance.
- **M2 completed 2026-08-11.** Student join/apply verified end-to-end via the seeded student; admin mutation click-through still pending Google OAuth credentials (same as M1).
| 4 | **Calendar & policy + ship** | Google Calendar sync, build days (required/optional), excusals, attendance calendar grid, My Attendance, admin settings page, Playwright smoke suite, Vercel + Supabase production deploy | [2026-08-11-m4-calendar-policy-ship.md](2026-08-11-m4-calendar-policy-ship.md) |

**M4 scope decision (2026-08-11):** two v1 items hard-require the user's accounts/secrets and are outward-facing/irreversible, so they ship as **code + a setup runbook** the user executes, mirroring the OAuth precedent — not performed autonomously:
- **Google Calendar sync** needs a Google service account + calendar id. Built with an **injectable fetch** and verified against a fake payload + the manual build-day path (which works without GCal); credential setup documented in `docs/setup/google-calendar.md`.
- **Production deploy (Vercel + Supabase)** needs the user's accounts, secrets, domain, and is outward-facing. Ships as a deploy runbook + env reference. **The Vercel MCP deploy tools are NOT used.**
Everything else (attendance computation, build days, excusals, `/calendar`, `/me/attendance`, `/admin/settings`, Playwright smoke, parked-item polish) is built and locally verified.

**M4 completed 2026-08-11.** All 12 tasks implemented subagent-driven on master, per-task + whole-branch reviewed, CI green (lint/typecheck/unit + a Playwright E2E job). The E2E suite surfaced three real latent bugs that mocked unit tests structurally could not catch — (1) ambiguous PostgREST `person` embeds (`PGRST201`) that silently emptied who's-here/leaderboard/flagged/applications (the last latent since M2), (2) CI-only spec-seeding gaps, and (3) **`service_role` had no table GRANTs on a freshly-reset database**, which would have broken every server query on a fresh production deploy — all fixed (the grants now ship as migration `20260811101553_service_role_grants.sql`). The final whole-branch review caught four more correctness defects in the GCal↔attendance and sweep↔attendance seams (all-day-event date off-by-one, un-paginated sync, cross-midnight sweep attribution, optional-day denominator), all fixed. **GCal sync and production deploy ship as code + runbooks** (`docs/setup/google-calendar.md`, `docs/setup/deploy.md`) for the user to execute — not performed autonomously.

**v1 is feature-complete.** Remaining before a real launch is user-gated: connect a Google Calendar service account, and follow `docs/setup/deploy.md` to deploy to Vercel + hosted Supabase.

Deferred entirely (issues [#1–#27](https://github.com/RAR1741/hub/issues?q=label%3Afuture-idea)).

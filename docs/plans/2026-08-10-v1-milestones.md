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
| 3 | **Attendance core** | Periods (seasons), sessions with one-open-session invariant, kiosk page + device tokens, who's-here poll, hours totals + leaderboard + per-member detail, flagged-sessions screen, nightly sweep (pg_cron) | *written after M2* |

**Carry-forwards from M2's final review (fold into M3, or M4/deploy where noted):**
- **Rate-limit client IP trust (M4/deploy):** `clientIp` in `src/lib/rate-limit.ts` uses the first `x-forwarded-for` hop, which is client-spoofable. When we deploy (M4), key the public-endpoint limiters on the platform-provided trusted client IP (e.g. Vercel's real-IP header) instead.
- **Team cycle display (follow-up):** `buildTeamTree` surfaces orphaned parents as roots but silently drops a deliberate `A→B→A` cycle (createable across two admin edits; the self-parent guard only blocks `A→A`). Data is intact — only the tree render hides it. If/when team editing gets heavier use, either detect cycles in `updateTeam` or surface unreachable nodes as roots.
- **Admin non-admin redirect (cosmetic):** admin pages `redirect("/login")` for a logged-in non-admin; consider redirecting to `/` (or a 403 view) instead so an already-signed-in student isn't bounced to a login page.
- **Direct unit tests for `createPerson`/`updatePerson`** 409/404 branches (currently only exercised via routes/typecheck) — cheap insurance.
- **M2 completed 2026-08-11.** Student join/apply verified end-to-end via the seeded student; admin mutation click-through still pending Google OAuth credentials (same as M1).
| 4 | **Calendar & policy + ship** | Google Calendar sync, build days (required/optional), excusals, attendance calendar grid, My Attendance, admin settings page, Playwright smoke suite, Vercel + Supabase production deploy | *written after M3* |

Deferred entirely (issues [#1–#27](https://github.com/RAR1741/hub/issues?q=label%3Afuture-idea)).

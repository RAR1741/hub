# Team Hub v1 — Milestone Roadmap

Spec: [docs/specs/2026-08-10-v1-design.md](../specs/2026-08-10-v1-design.md) (approved 2026-08-10).

v1 is delivered as four sequential plans; each produces working, testable software. Detailed task plans are written when the preceding milestone completes, so they reflect the real codebase rather than guesses.

**All local development happens inside a VS Code Dev Container** — Docker Desktop, VS Code, and a browser are the only things installed on a developer's machine. Every command in every milestone plan runs in that container.

| # | Milestone | Delivers | Plan |
|---|---|---|---|
| 1 | **Foundation & auth** | Dev container, Next.js + Supabase scaffold, core schema (person, account_request, kiosk_device, app_setting), RLS default-deny, student-ID sessions, mentor Google OAuth with allowlist + first-user-admin bootstrap, `getViewer()`/role enforcement, login page, CI | [2026-08-10-m1-foundation-auth.md](2026-08-10-m1-foundation-auth.md) |
| 2 | **Roster & teams** | Person CRUD + profiles, team tree + memberships + join modes + application queue, account-request review queue, admin people/teams/requests pages, guest-scoped roster views | *written after M1* |
| 3 | **Attendance core** | Periods (seasons), sessions with one-open-session invariant, kiosk page + device tokens, who's-here poll, hours totals + leaderboard + per-member detail, flagged-sessions screen, nightly sweep (pg_cron) | *written after M2* |
| 4 | **Calendar & policy + ship** | Google Calendar sync, build days (required/optional), excusals, attendance calendar grid, My Attendance, admin settings page, Playwright smoke suite, Vercel + Supabase production deploy | *written after M3* |

Deferred entirely (issues [#1–#27](https://github.com/RAR1741/hub/issues?q=label%3Afuture-idea)).

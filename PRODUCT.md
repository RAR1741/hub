# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three roles, distinct situations:
- **Students (roster members):** sign in via student ID (kiosk or self-serve) to check hours,
  view attendance, and request excusals on `/me/attendance`.
- **Mentors/admins:** sign in via Google OAuth; manage roster/teams/periods, review requests and
  flagged sessions, run hours/attendance reports.
- **Kiosk device (shared/public):** an unauthenticated-per-user, shared shop device for
  sign-in/out and the who's-here board — used by whoever walks up.

## Product Purpose

Attendance + roster tracking for FRC Team 1741 (Red Alert Robotics), replacing a
spreadsheet/paper sign-in sheet with a system built around how an FRC season actually runs.

## Positioning

FRC-specific build-season workflows: build-day scheduling, season hours goals, Google Calendar
sync (required/optional build days, excusals), and a review-gated excusal-request flow — not a
generic timeclock.

## Operating Context

- Season runs in build days; attendance periods (`/admin/periods`) scope the season.
- Kiosk sits at the shop door — shared device, used in passing, not a personal workstation.
- Google Calendar is the source of truth for scheduled build days (hourly sync via
  pg_cron/pg_net).

## Capabilities and Constraints

See [docs/features.md](docs/features.md) for the full current feature catalog (v1
feature-complete): roster/teams, split-audience auth, kiosk sign-in/out + who's-here board,
attendance periods + hours/leaderboard, flagged-session review + nightly auto-close, Google
Calendar sync, self-service excusal requests, CSV roster import, CSV hours/attendance reports.

**Constraint:** kiosk flows must stay touch-first and low-friction — big touch targets, minimal
typing, fast sign-in/out — since it's a shared device used mid-motion, not a seated workstation.

## Brand Commitments

Team name/identity: FRC Team 1741, "Red Alert Robotics." No logo or brand color assets are
checked into the repo yet (`public/` currently holds only unused Next.js placeholder SVGs) —
future visual work should not invent a logo or fabricate team colors; treat team branding as an
open input to source from the user rather than assume.

## Evidence on Hand

- [docs/features.md](docs/features.md) — full feature catalog.
- [docs/design/ui-system.md](docs/design/ui-system.md) — existing UI/design-system notes
  (incumbent visual documentation, separate from this file).
- [docs/specs/2026-08-10-v1-design.md](docs/specs/2026-08-10-v1-design.md) — v1 design spec.
- No real logo, brand color, testimonial, or press assets on hand.

## Product Principles

- Build-season-shaped, not generic: model periods, build days, and excusals the way an FRC team
  actually runs a season, rather than a generic HR timeclock.
- Kiosk is a shared, touch-first surface — optimize for speed and low friction over density.
- Review-gated by role: mentors/admins approve consequential actions (excusals, membership,
  account requests); students self-serve requests but never act on someone else's behalf.
- Calendar sync is authoritative for scheduled build days — don't duplicate that scheduling logic
  elsewhere.

## Accessibility & Inclusion

No project-specific accessibility requirement established beyond general web accessibility
practice.

# Team Hub — Research & Build Plan

**Date:** 2026-08-10
**Goal:** Build a web app for the robotics team to track attendance/hours, members, parts/purchasing, and communications — informed by existing OSS tools, but tailored to our use case.

## Process

### Phase 1 — Survey (done)
Surveyed seven sources and extracted every user-facing feature, with code references pinned to the commit each repo was surveyed at:

| Source | Type | Surveyed at |
|---|---|---|
| [GatherPack/gatherpack](https://github.com/GatherPack/gatherpack) | OSS repo | `6f3047d` |
| [Mechanical-Advantage/AdvantageTrack](https://github.com/Mechanical-Advantage/AdvantageTrack) | OSS repo | `218e6a1` |
| [RAR1741/tracking](https://github.com/RAR1741/tracking) | OSS repo | `89bc811` |
| [den.tigerdynasty.app](https://den.tigerdynasty.app/) | Hosted app | web survey |
| [Team254/cheesy-hours](https://github.com/Team254/cheesy-hours) | OSS repo | `518df05` |
| [Team254/cheesy-mail](https://github.com/Team254/cheesy-mail) | OSS repo | `bbc62a0` |
| [Team254/cheesy-parts](https://github.com/Team254/cheesy-parts) | OSS repo | `034ef59` |

Output: [01-feature-catalog.md](01-feature-catalog.md) — features grouped by domain, each with source references and an empty decision field.

### Phase 2 — Feature review (you, manual)
Go through the catalog and fill in each feature's **Decision** field:
- `Need` — must have for v1
- `Nice` — want eventually, not v1
- `Skip` — not for our team
- Where sources implement the same feature differently, note the **preferred variant** in the decision field.

### Phase 3 — Design spec
From the `Need` list: data model, auth/roles, page map, and stack confirmation. Produces a design doc we both review.

### Phase 4 — Implementation plan & build
Turn the spec into an ordered implementation plan (using the writing-plans workflow), then build incrementally — one domain at a time (likely attendance first, since that's the highest-frequency use).

## Stack considerations

See the "Stack, cost & hosting" section of the feature catalog for the full analysis. Working hypothesis going in: **Node/TypeScript + Vercel + Supabase** — evaluated there against what the surveyed features actually require (auth & roles, kiosk check-in, scheduled jobs, outbound email, exports).

## Ground rules

- **Recreate features, not code.** Most surveyed repos are not JavaScript, and licenses vary — we take feature ideas and data-model lessons, not source. Any direct code porting must respect the source license (noted per repo in the catalog appendix).
- **YAGNI.** Anything not marked `Need` stays out of v1.

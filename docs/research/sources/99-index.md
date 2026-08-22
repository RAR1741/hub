# Source Index — Long-Tail Discoveries (Expansion Round)

> **Superseded by round 3.** Most of the repos below now have full feature surveys, and the exhaustive round-3 sweep lives in [../03-exhaustive-index.md](../03-exhaustive-index.md). This file is kept for history.


**Date:** 2026-08-22
**What this is:** One-paragraph index entries for sources discovered in the expansion round that
did **not** warrant a full survey file. Full surveys live as sibling files in this directory; the
feature catalog is [../02-feature-catalog.md](../02-feature-catalog.md). Entries are grouped by the
research area they touch most. Licenses and last-activity dates are as observed at discovery time
(2026-08-22). Per the ground rules, **no-license repos are ideas-only — never copy code.**

Areas key: attendance · people · integrations · communication · purchasing · design-manufacturing.

---

## Purchasing & inventory

- **[legoguy1000/FRC-Inventory](https://github.com/legoguy1000/FRC-Inventory)** — TypeScript
  inventory-tracking app for FRC teams, moderate codebase (~1 MB). No license; last activity
  2025-02. Notable: one of the few standalone FRC inventory apps that isn't a spreadsheet.
  Areas: purchasing, design-manufacturing.
- **[AmrinS49/quartermaster](https://github.com/AmrinS49/quartermaster)** — free, open-source
  inventory management system built explicitly for FRC teams to track parts/stock. GPL-3.0;
  inactive since 2023-12. Notable: generic, reuse-oriented naming and licensing (intended for
  other teams, not just its author's). Areas: purchasing, design-manufacturing.
- **[redwatchsoftwareteam/inventory-radar-frc](https://github.com/redwatchsoftwareteam/inventory-radar-frc)**
  — inventory web app by FRC 2720 (Red Watch Robotics), explicitly offered as a hosted service to
  other teams ("email us if your team would like to use our web app"). No license; last activity
  2024-01. Notable as precedent for a team-run hosted tool shared beyond its own org (like Den).
  Areas: purchasing.
- **[eduardohartz/inventorysystembackend](https://github.com/eduardohartz/inventorysystembackend) +
  [inventorysystemfrontend](https://github.com/eduardohartz/inventorysystemfrontend)** —
  self-hosted inventory system originally built for FRC 1318, split front/back repos, both touched
  into late 2025. No license. Areas: purchasing.
- **[MNTadros/FRC_API](https://github.com/MNTadros/FRC_API)** — FastAPI/Python inventory
  management system for FRC component/part tracking. Small, recent (2025-09), unlicensed,
  unstarred — marginal. Areas: purchasing.
- **[team1306/New-Purchasing-Process](https://github.com/team1306/New-Purchasing-Process)** (+
  `new-purchasing-process-backend`) — FRC 1306's in-progress purchase-order tracking web app
  (JS front + back). No license; pushed 2025-12 but currently a thin scaffold (~270 lines total).
  Worth re-checking as it matures. Areas: purchasing.
- **[Team2337/nerdy-parts](https://github.com/Team2337/nerdy-parts)** — FRC 2337's fork of
  cheesy-parts, kept alive through 2023 (more recent than most forks). BSD-2-Clause. Confirms the
  cheesy-parts lineage remains the de-facto OSS parts tool teams adapt. Areas: purchasing,
  design-manufacturing.
- **[DeepBlueRobotics/deep-blue-parts](https://github.com/DeepBlueRobotics/deep-blue-parts)** —
  another cheesy-parts fork (2018 season, updated through 2020) with more divergence than most.
  BSD-2-Clause. Areas: purchasing, design-manufacturing.
- **[hasenburgjohansen515-design/Inventory-Tracker](https://github.com/hasenburgjohansen515-design/Inventory-Tracker)**
  — brand-new (pushed 2026-08-19) inventory tracker for an FRC/FTC team (KCAL); too fresh to
  assess depth. No license. Areas: purchasing.

## Design & manufacturing tracking

- **[TheDawnKing24/FRC-shop-tool-tracker](https://github.com/TheDawnKing24/FRC-shop-tool-tracker)**
  — QR-code-based tool/inventory tracking for FRC workshops (JS + Firebase Firestore + Vite).
  MIT; pushed 2026-07. Small but functional; QR-per-tool is the notable idea. Areas:
  design-manufacturing.
- **[OwenRossing/7028-parts](https://github.com/OwenRossing/7028-parts)** — FRC 7028's
  "manufacturing parts tracker v2 rewrite": Next.js/Prisma/Docker with auth, login, settings,
  themed UIs. No license; last activity 2026-03. Real feature code, unclear adoption. Areas:
  design-manufacturing.
- **[AadiJo/cadsense](https://github.com/AadiJo/cadsense)** — AI-assisted CAD review tool that
  reads Onshape project context and flags mechanical design issues against FRC-specific rules.
  MIT; active (2026-08). Sizable TypeScript codebase; adjacent to design *review* rather than
  build tracking. Areas: design-manufacturing, integrations.
- **[hammerheads5000/FRC-COTS](https://github.com/hammerheads5000/FRC-COTS)** — Fusion 360 add-in
  for managing COTS part files/libraries in team CAD workflows; referenced by other teams' tooling
  (FRCTools README). MIT; active (2026-08). Sits near the excluded CAD-part-library genre but is a
  workflow tool, so indexed. Areas: design-manufacturing.
- **[robogreg/REV_parts_tracker](https://github.com/robogreg/REV_parts_tracker)** — "REV Parts
  Pit", an event-day parts distribution/tracking system for FRC/FTC/FLL competitions. License
  unknown; active 2026-04. Boundary case: scoped to competition-venue logistics, close to the
  excluded event-software genre — indexed for completeness only. Areas: design-manufacturing.

## Communication & bots

- **[CMEONE/FRCBot](https://github.com/CMEONE/FRCBot)** — feature-rich Discord bot for FRC teams
  (hosted at frcbot.togatech.org, self-hostable), pulling FRC/TBA event and match data into team
  servers. AGPL-3.0; dormant since 2022-10 but still hosted. Mostly match/event info rather than
  internal-ops workflows. Areas: communication, integrations.
- **[ngregrichardson/BertBot](https://github.com/ngregrichardson/BertBot)** — FRC 4750's
  self-hosted Discord bot (Node.js), announced on Chief Delphi. Notable: an order-request form
  flows into Trello and triggers a Gmail notification to mentors — a small, real
  purchasing-via-chat integration. No license; archived, last commit 2019-01. Areas:
  communication, purchasing, integrations.
- **[bc3tech/frc-discord-bot](https://github.com/bc3tech/frc-discord-bot)** — substantial C#
  Discord bot for FRC teams (~3.7 MB), updated 2026-05. License flagged NOASSERTION — verify
  before taking anything beyond ideas. Areas: communication.
- **[suhaank077/FRC-Discord-Bot](https://github.com/suhaank077/FRC-Discord-Bot)** — small Python
  Discord bot for FRC 5190 combining chat commands with inventory lookups. No license; last
  activity 2024-04. Marginal depth. Areas: communication, design-manufacturing.
- **[andrewda/frc-slack-bot](https://github.com/andrewda/frc-slack-bot)** — early (2016) Slack bot
  built for FRC teams; clean historical example of the team-chat-bot category. No license;
  abandoned since 2016. Areas: communication, integrations.
- **[mojahidmamu/BSPI-BotForge](https://github.com/mojahidmamu/BSPI-BotForge)** — "Robotics Club
  Management System" (not FRC — a general robotics-club management UI, ~9.5 MB JS, active
  2026-07). No license. Indexed as a comparable from outside FIRST; scope unverified. Areas:
  people.
- **Scoultimate** ([CD thread](https://www.chiefdelphi.com/t/frc-discord-bot-scoultimate/386713))
  — actively developed hosted Discord bot providing real-time FRC/TBA stats, event details, and
  match notifications; distributed via top.gg/Discord invite, no public repo found. Areas:
  communication, integrations.
- **FRC Game Notifier**
  ([CD thread](https://www.chiefdelphi.com/t/frc-game-notifier-discord-bot-that-dms-you-when-your-team-or-your-favorite-teams-is-on-deck/518804))
  — Discord bot watching TBA and frc.nexus that DMs users when their team is on deck or has
  finished a match (2026-04). No public repo found. Areas: communication, integrations.

## Integrations

- **TBA Requests**
  ([CD thread](https://www.chiefdelphi.com/t/tba-requests-google-sheets-add-on-for-blue-alliance-data/166636))
  — Google Sheets add-on (Google Workspace Marketplace) pulling The Blue Alliance API data
  directly into spreadsheets; widely used for stats/roster sheets without writing API code.
  Areas: integrations.
- **[TechplexEngineer/frc-calendar-to-ical](https://github.com/TechplexEngineer/frc-calendar-to-ical)**
  — Cloudflare Worker exporting FIRST calendar events as iCal for Google Calendar import. No
  license; active 2026-06. Small single-purpose utility. Areas: integrations, communication.
- **[tech-support03/Claude4FRC](https://github.com/tech-support03/Claude4FRC)** — small MCP server
  connecting Claude to Onshape CAD for FRC design assistance (Python). No license; 2026-04.
  Novelty entry for the integrations area. Areas: integrations, design-manufacturing.
- **[Max5254/onshape4frc.com](https://github.com/Max5254/onshape4frc.com)** — community
  resource site for Onshape-centric FRC CAD workflows; documentation hub rather than a tool.
  Areas: integrations, design-manufacturing.

## Attendance & people

- **[Team254/cheesy-action-items](https://github.com/Team254/cheesy-action-items)** — Team 254's
  internal action-item/task tracker for leads and mentors (2013–14 era, archived 2020).
  BSD-2-Clause. Completes the "cheesy" suite picture alongside cheesy-hours/-mail/-parts; simple
  assign-and-track to-dos predating their move to modern task tools. Areas: people, communication.
- **[Team3256/myWB-web](https://github.com/Team3256/myWB-web) /
  [myWB-flutter](https://github.com/Team3256/myWB-flutter)** — FRC 3256's combined web + Flutter
  suite covering inventory, attendance, and scouting while doubling as the public team site. No
  license; archived since 2021-03. Notable for spanning several ops areas in one codebase. Areas:
  attendance, purchasing, communication.
- **[FRC4392/DeceptiveHours](https://github.com/FRC4392/DeceptiveHours)** — FRC 4392's
  clock-in/out kiosk with mentor roster management and a protected review dashboard. No license;
  active 2026-07. Standard-feature attendance tool in an already-saturated category. Areas:
  attendance, people.
- **[Aaron691/TeamPortal](https://github.com/Aaron691/TeamPortal)** — FRC team portal for logging
  hours, updating personal info, and viewing turned-in items (forms/paperwork tracking — a
  people-area feature few sources have). No license; abandoned since 2020. Areas: people,
  attendance.

## Chief Delphi practice threads (what teams actually use)

These document real-world tool choices across many teams; they are sources for the
communication-methods and practice questions even where no repo exists.

- **[Looking for an Order & Inventory Control system](https://www.chiefdelphi.com/t/looking-for-an-order-inventory-control-system/523479)**
  — teams recommend what they actually use for order/inventory control: spreadsheets dominate,
  FRCTools Orders and cheesy-parts-style systems recur. Areas: purchasing.
- **[How do you track inventory and manufacturing?](https://www.chiefdelphi.com/t/how-do-you-track-inventory-and-manufacturing/519939)**
  (2026) — range of ad-hoc tools (Sheets, Airtable, Notion) for COTS location/quantity, stock
  material, and manufacturing status; dedicated tools are the exception. Areas:
  design-manufacturing.
- **[How do you keep track of parts that have been manufactured?](https://www.chiefdelphi.com/t/how-do-you-keep-track-of-parts-that-have-been-manufactured-throughout-the-season/436936)**
  (2023) — earlier snapshot of the same question. Areas: design-manufacturing.
- **[What does your team use for design notes?](https://www.chiefdelphi.com/t/what-does-your-team-use-for-design-notes/520788)**
  — engineering-notebook/design-notes tooling survey. Areas: design-manufacturing.
- **[Preferred Slack-like solutions for school-based teams?](https://www.chiefdelphi.com/t/preferred-slack-like-solutions-for-school-based-teams/442834)**
  (2023) — what chat platforms teams use given school IT restrictions (Slack vs Discord vs Teams).
  Areas: communication.
- **[TBA to Slack integration](https://www.chiefdelphi.com/t/tba-tba-to-slack-integration/151105)**
  (2016) and **[TBA API to Discord webhook help](https://www.chiefdelphi.com/t/tba-api-to-discord-webhook-help/364416)**
  (2019) — documented patterns for bridging TBA event/match data into team chat. Areas:
  integrations, communication.

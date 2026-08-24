# Ma7erial/FTC-Dashboard — Source Survey

**Repo:** Ma7erial/FTC-Dashboard — https://github.com/Ma7erial/FTC-Dashboard
**Surveyed-at:** 399375bbfb07ab1aab41776b5b06f87b2113f983 (get via: gh api repos/Ma7erial/FTC-Dashboard/commits --jq '.[0].sha')
**Permalink form:** https://github.com/Ma7erial/FTC-Dashboard/blob/399375bbfb07ab1aab41776b5b06f87b2113f983/<path>
**Stack:** React 19 + TypeScript (Vite, Tailwind CSS v4, Framer Motion/`motion`), Express.js backend, better-sqlite3, WebSocket (`ws`), local LLM inference via node-llama-cpp/Ollama (Phi-3.5), Exa web search API
**License:** Ambiguous/conflicting — GitHub repo license (LICENSE file) is GPL-3.0, but `package.json` declares `"license": "MIT"`. Treat as copyleft (GPL-3.0 governs, being the actual LICENSE file) — ideas only, no code reuse.
**Last activity:** 2026-05-31 (pushed_at)
**FRC team:** FTC teams #10937 and #30548, Stuttgart High School (per README) — FTC team, labeled as FTC-comparable per scope rules
**Areas:** people/rosters, communication, (adjacent: time/attendance, parts/inventory — noted for context but scored primarily for people/rosters + communication)

## Purpose
A single-process, self-hostable (npm/npx-installable) club management dashboard for an FTC team: one Express+SQLite server backing a React SPA, covering rosters/roles, attendance, tasks, budget, outreach hours, announcements/communications, in-app chat, and a locally-run LLM ("AI Scout") for news summarization and attendance-excuse triage. Everything (DB, uploads, LLM) runs on the host machine — no cloud backend.

## Auth & Roles
- Email + bcrypt-hashed password login (`server.ts:642` `/api/auth/login`); first login with no password set triggers a `needsSetup` flow (`/api/auth/setup`, `server.ts:661`) that hashes and stores a new password; `/api/auth/reset` (`server.ts:670`) clears a member's password back to unset.
- Custom session tokens (not JWT/cookies-lib) stored server-side in a `sessions` table with 24h expiry, validated per-request via `validateSession()` (`server.ts` ~L440-470); a parallel `stream_sessions` table buffers chunked AI-streaming responses per session so a client can resume a dropped SSE-style stream.
- Role model is two-tier: `members.role` (free-text label) plus `is_board` (boolean "admin" flag) plus a `scopes` JSON array (e.g. `attendance`, `budget`, `tasks`, `inventory`, `code`, `admin`) for fine-grained feature gating.
- Enforcement is almost entirely **client-side**: `App.tsx:565` `hasScope(scope)` checks `currentUser.is_board`/`scopes` in the React tree to lock UI sections (`App.tsx:714` `isLocked = item.scope && !hasScope(item.scope)`), but the Express routes themselves largely do not re-check scopes/role server-side before mutating data — a client that calls the API directly can bypass the UI gate. Board-only tasks (`tasks.is_board`) are similarly filtered client-side (`App.tsx:1948`).

## Data Model
SQLite (`better-sqlite3`, file `dashboard.db`), schema created inline in `server.ts:180-365`:
- `teams` (name, number, theming colors) ← `members` (team_id FK, name, role, email unique, password, is_setup, is_board, scopes JSON, per-user theme colors)
- `attendance` (member_id FK, date, status enum P/A/L/E/U/S, reason, is_excused) unique per (member, date); `hidden_dates` (dates excluded from attendance grids)
- `tasks` (team_id, assigned_to→members, title/description/status todo|in-progress|done, due_date, is_board flag, completed_at)
- `budget` (team_id, type income|expense, amount, category, description, date)
- `outreach` (title, description, date, hours, location) — community-service hour logging
- `communications` (recipient, subject, body, date, type email|announcement)
- `documentation` (type meeting|funding|milestone, title, content, images JSON, date)
- `inventory` (team_id, name, part_number, sku unique, quantity, assigned_to→members, location, category, cost) — basic parts/stock tracking, includes a REV Robotics product-page scraper (`server.ts:1243` `/api/inventory/scrape-rev`, uses `cheerio`)
- `messages` (sender_id→members, content, timestamp, soft-delete via deleted_at, optional file attachment fields) + `notifications` (user_id, content, type mention|task|system, is_read)
- `code_files`/`code_commits` (team_id, file_path unique per team, language, content, hash, branch main/drafts) — a lightweight git-like version store for team code files (out of survey scope: robot control code; noted only as a data-model curiosity)
- `sessions` / `stream_sessions` — auth/session and AI-stream-resume bookkeeping

## Features
**People/rosters**
- Team CRUD with per-team theming (accent/primary/text colors) — `server.ts:679-702` `/api/teams`, `App.tsx` `TeamsView` (`App.tsx:1087`)
- Member roster CRUD with role, board flag, and scope assignment UI (checkbox list of feature scopes) — `server.ts:704-760` `/api/members`, `App.tsx:1087-1410` `TeamsView`
- Per-member profile/theme customization — `App.tsx:3066` `ProfileView`

**Communication**
- In-app real-time chat over WebSocket with @-mention parsing that fires notifications (`server.ts` WS handler ~L595-625), file attachments via multer upload (`server.ts:886` `/api/messages/upload`, 10MB limit), soft-delete of messages
- Notifications feed per user, mark-as-read (`server.ts:970-986`)
- Communications log for emails/announcements sent to the club (`server.ts:1566-1600` `/api/communications`) — a record-keeping log, not an actual send integration
- "AI Scout": local-LLM-generated FTC/robotics news summaries, with Exa web search grounding and localStorage caching + streaming (SSE-style chunked response) — `src/services/aiService.ts`, `server.ts:1339` `/api/ai/fetch-news`

**Time/attendance (adjacent area, present but not primary focus)**
- Grid-based attendance entry with batch save (`server.ts:778` `/api/attendance/batch`), excused/unexcused tracking, hideable dates, attendance summary/session endpoints
- AI-assisted excuse evaluation against a configurable criteria string (`server.ts:1462` `/api/ai/check-excuse`, settings key `excuse_criteria`) and AI attendance-pattern insights (`server.ts:1393` `/api/ai/attendance`)

**Other (tasks/budget/outreach/inventory — outside the 6-area scope but present)**
- Kanban-style task board with board-only/private tasks, due dates, completion tracking (`App.tsx:1928` `TasksView`)
- Income/expense budget ledger by category (`App.tsx:2188` `BudgetView`)
- Outreach/community-service hour logging
- Basic parts inventory with a REV Robotics scrape-to-populate helper

**AI-generated club activity summaries** — `server.ts:1491` `/api/ai/activity-summary`, aggregates attendance/tasks/budget/outreach into a narrative summary via local LLM.

## Integrations
- **Exa** (web search API, `EXA_API_KEY`) — grounds the AI news-fetch prompt in live search results (`server.ts` `searchExa`)
- **Ollama** (`OLLAMA_URL`/`OLLAMA_MODEL`) or bundled **node-llama-cpp** running a local GGUF model (Phi-3.5 recommended) — all "AI" features route through one local LLM call wrapper (`callOllama`), no cloud AI API (OpenAI/Gemini) despite an aiService.ts comment noting it replaced an earlier Gemini-based implementation
- No Slack/Discord/email-send/SMS/OAuth integrations; "communications" is an internal log only

## Notable Implementation Details
- **Monolithic files**: nearly the entire backend lives in one 1,973-line `server.ts` (all routes, schema, WS logic, session management inline) and nearly the entire frontend in one 3,514-line `App.tsx` (every view component defined in the same file). No route/controller separation, no component-per-file structure — a re-implementer should NOT copy this structure, but it is easy to grep end-to-end for exact behavior.
- **Ad-hoc migrations**: schema evolution is done via repeated `PRAGMA table_info` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`-style guards run at every server boot (`server.ts:369-420`), not a migration-file system — fragile at scale but zero-dependency and works for a single-file SQLite deployment.
- **Server-side scope enforcement gap**: as noted under Auth & Roles, the `scopes`/`is_board` gate is enforced in the React layer, not in Express route handlers — a real re-implementation should move that check server-side.
- **AI features gated by `DISABLE_NEWS` env flag** and a `MAX_TOKENS_LIMIT`/per-feature numeric settings row in the `settings` table, letting an operator throttle/disable local-LLM cost (CPU inference, ~30-60s per generation per README) without redeploying.
- **npx-installable CLI** (`bin/cli.js`, `setup.ts` using `@clack/prompts`) walks a first-run operator through env/model setup — a reasonable "distribute as a tool, not a repo clone" pattern worth noting for any future single-tenant self-host tool in this space.
- Streaming AI responses use a custom resumable-stream table (`stream_sessions`) rather than a standard SSE library — lets a client reconnect mid-generation and replay missed chunks.

## Verdict
Substantive and relevant — a real, working single-team club-ops app (not a toy scaffold) with concrete communication (chat + mentions + notifications + announcements log) and people/roster (scoped roles, team theming) features worth reviewing for UX/data-model ideas; the scope-based permission model (feature-scopes-as-JSON-array assigned per member) and the resumable AI-stream session pattern are the two most portable ideas. License is GPL-3.0 (the LICENSE file) despite package.json claiming MIT — treat as copyleft, ideas only.

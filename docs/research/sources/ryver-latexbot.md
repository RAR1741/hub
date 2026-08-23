# LaTeX Bot (ryver-latexbot) — Source Survey

**Repo:** tylertian123/ryver-latexbot — https://github.com/tylertian123/ryver-latexbot
**Surveyed-at:** ff9844a5461429788e2e86d5a679922cda69c21d
**Permalink form:** https://github.com/tylertian123/ryver-latexbot/blob/ff9844a5461429788e2e86d5a679922cda69c21d/<path>
**Stack:** Python 3 (asyncio), `aiohttp` (web server + HTTP client), `pyryver` (Ryver API client), `marshmallow` (schemas/serialization), `lark-parser`, `google-api-python-client` (Google Calendar), Docker/docker-compose for deployment, JSON files for persistence (no database)
**License:** MIT (LICENSE file present) — free to reuse ideas and patterns
**Last activity:** 2022-10-07 (single active period; repo pushed_at matches surveyed commit)
**FRC team:** Team Arctos 6135
**Areas:** communication (primary); third-party integrations (TBA, GitHub, Google Calendar, Reddit/xkcd, Checkiday, Open Trivia DB)

## Purpose
A general-purpose chat-ops bot for a team's Ryver organization (Ryver is a Slack-like team chat/task platform) that adds moderation, role/notification management, and pulls in outside data (FRC team/event info from The Blue Alliance, GitHub issue/PR sync, Google Calendar events, trivia, xkcd, holidays) directly into chat — reducing the need for members to check multiple external sites/tools.

## Auth & Roles
- No user accounts of its own; identity comes entirely from the underlying Ryver org's users (`pyryver.User`).
- Command authorization uses a 5-level **Access Level** hierarchy (`latexbot/latexbot/command.py`): `EVERYONE` (0) < `FORUM_ADMIN` (1) < `ORG_ADMIN` (2) < `BOT_ADMIN` (3) < `MAINTAINER` (4, hardcoded via `LATEXBOT_MAINTAINER_ID` env var). Resolved per-invocation from Ryver's own admin/org-admin flags plus a bot-config `admins` list — no separate permission store.
- Per-command **Access Rules** (`schemas.py: AccessRuleSchema`) allow overriding a command's default level with explicit allow/disallow lists of user IDs or role names — lets an org admin loosen or tighten one specific command without touching code.
- A separate **Roles** system (`command_roles`, `command_add_to_role`, etc. in `commands.py`) is user-defined chat groups (e.g. "@programming") that expand into `@mentions` of all members — not an auth concept, a notification-fanout concept.
- The embedded web server (`server.py`) uses **HTTP Basic Auth** with three flat passwords from env vars (`LATEXBOT_SERVER_AUTH_ADMIN/WRITE/READ`), each granting a tier (`read` < `write` < `admin`); constant-time comparison is not used for the password itself but GitHub webhook signatures are verified with `hmac.compare_digest` (`server.py: verify_signature`).

## Data Model
No database; all state is small JSON files persisted to disk and loaded/dumped via `marshmallow` schemas (`schemas.py`):
- **Config** — org-wide settings: admins list, GitHub-updates chat, GitHub issues/PR Ryver Task board, GitHub user→Ryver user map, daily-message chat/time, command aliases, per-command access rules (`ConfigSchema`).
- **Roles** — `role name -> [user IDs]` mapping.
- **Keyword Watches** — `keyword -> {chat, users to notify}` for chat-wide "notify me when X is mentioned" (Slack-keyword-notification equivalent).
- **Trivia** — custom question bank (JSON) merged with the public Open Trivia DB API; per-user score/leaderboard tracked in memory/JSON.
- **Analytics** — command-usage counts, per-user message-activity counts, shutdown timestamps (`analytics.py`), exposed as a JSON API + a small dashboard.
- **Aliases/Macros** — string substitution maps for commands and chat message text respectively.

## Features

### Communication (core, `commands.py`, `latexbot.py`)
- LaTeX/math rendering (`render`, `renderSimple`) and chemistry equations via `mhchem`, farmed out to a separate `tex-slave` XeTeX worker container (`tex-slave/slave.py`, `latexbot/latexbot/render.py`) — decouples untrusted TeX compilation from the bot process.
- Mass **delete** (`command_delete_messages`) and **move** messages between forums/teams (`command_move_messages`), plus `command_count_messages_since` for un-scrolling a busy channel.
- Chat **mute/unmute** and **timeout/untimeout** (temporary or indefinite) and **read-only** mode toggle for a forum/team (`command_mute`, `command_timeout`, `command_read_only`).
- **Keyword Watches**: per-user keyword subscriptions across chats, more flexible than Ryver's own notification rules (`command_watch`, `server.py: /keyword_watches`).
- **Roles with @mention expansion**: define named groups and `@RoleName` in a message auto-expands to member mentions (`command_roles`, `command_add_to_role`, `command_export_roles`/`import_roles`).
- **Command aliases** and **message macros** (`command_alias`, `command_macro`) — reusable shorthand text substitutions.
- **Daily message** scheduler (configurable time) that posts a rollup of the day's Calendar events + new xkcd + Checkiday holidays (`command_daily_message`, `command_set_daily_message_time`).
- Built-in **trivia game** (single or multiplayer) backed by Open Trivia DB with a custom-question override file and a leaderboard command (`command_trivia`, `command_leaderboards`, `trivia.py`).
- xkcd fetch (`command_xkcd`) and Checkiday holiday-of-the-day lookup (`command_checkiday`).
- Runtime admin controls: enable/disable commands (`command_set_enabled`), remote shutdown (`command_kill`), sleep/pause, arbitrary async Python execution for the maintainer only (`command_execute`, and the web `/exec` endpoint) — powerful but dangerous "admin god-mode" pattern.
- Full JSON export/import of config, roles, and access rules for backup/migration (`command_export_config`/`import_config`).
- Built-in **analytics dashboard**: command-usage histogram, per-user message-activity, shutdown history, served as both raw JSON (`/analytics`) and an HTML/JS dashboard (`/analytics-ui`, `static/analytics-ui.html/js`).

### Third-party integrations
- **The Blue Alliance (TBA)** (`latexbot/latexbot/tba.py`, wired into `commands.py: command_tba`): thin `aiohttp`-based wrapper over TBA API v3 — team info, a team's events (by year or all-time), team event statuses, district list/rankings/teams/events, single event lookup, event rankings, event teams — each with a Markdown formatter (`format_team`, `format_event`) that renders a clean chat card with links back to TBA. This is the module most directly relevant as an FRC third-party-integration reference.
- **GitHub** (`latexbot/latexbot/github.py`, 300+ lines of per-event Markdown formatters + `server.py: _github_handler`): webhook receiver with HMAC-SHA1 signature verification, chat notifications for push/PR/issue/check-run/fork/etc. events, and two-way sync that mirrors GitHub Issues/PRs into a Ryver Task board (creates/edits/comments/completes/archives tasks, maps GitHub assignees to Ryver users via a configurable username map, mirrors labels as task tags).
- **Google Calendar** (`latexbot/latexbot/gcalendar.py`): service-account auth, list upcoming/today's events, quick-add via free-text, add/remove events — surfaced through `command_events`, `command_add_event`, `command_quick_add_event`, `command_delete_event`.
- **Reddit/xkcd** (`latexbot/latexbot/reddit.py`, `xkcd.py`) and **Checkiday** (holiday-of-the-day) for daily-digest flavor content.
- **Open Trivia DB** for the trivia game.

## Integrations
The Blue Alliance, GitHub (webhooks + Issues/PR → Ryver Task sync), Google Calendar (service account), Checkiday, Open Trivia DB, xkcd/Reddit. No Slack/Discord/email/SMS — Ryver is the sole chat surface (via `pyryver`).

## Notable Implementation Details
- **Untrusted-code isolation for rendering**: LaTeX compilation runs in a separate `tex-slave` container/process rather than in the bot's own process — a reusable pattern for any "render user input with a heavy/unsafe toolchain" feature.
- **GitHub → Task-board sync dedups by convention**: it tags created tasks with `latexbot-github` + `issue`/`pull-request` and finds existing tasks by scanning `task.get_subject().startswith(f"(#{number})")` rather than storing an explicit issue-id↔task-id mapping — simple but O(n) per event and fragile to title edits; a real re-implementation should use a persisted ID map instead.
- **`/exec` endpoint runs arbitrary `exec()`'d Python** against the live bot object, gated only by a shared Basic-Auth admin password — a deliberate "maintainer superpower" for live debugging, but a serious liability if ported as-is (no sandboxing, no audit log beyond the general logger).
- Flat, single-shared-secret Basic Auth (three static passwords in env vars) for the whole web API/dashboard — fine for a small mentor-run bot, but not a role-per-user auth model; a re-implementation with per-user accounts would be a meaningful upgrade.
- All persistence is via marshmallow-serialized JSON files (config/roles/trivia/watches) with no migrations and no concurrency control — acceptable at FRC-team scale (dozens of users) but wouldn't scale past that without a real datastore.
- Access-rule system (per-command allow/disallow overrides layered on a base access-level hierarchy) is a clean, reusable authorization design worth recreating even outside a chat-bot context.

## Verdict
Substantive and directly relevant: a mature (2+ years of activity), MIT-licensed, single-maintainer FRC team bot with a genuinely reusable TBA integration module (`tba.py`), a full bidirectional GitHub↔task-board sync, and a clean layered access-control model. Worth stealing: the TBA API wrapper shape, the access-level + access-rule authorization pattern, and the GitHub webhook→task-sync design (with a real ID map instead of subject-string matching).

# FRC Bot — Source Survey

**Repo:** CMEONE/FRCBot — https://github.com/CMEONE/FRCBot
**Surveyed-at:** 4e46d185efad92b20dddab3a81a17443110ef0f8
**Permalink form:** https://github.com/CMEONE/FRCBot/blob/4e46d185efad92b20dddab3a81a17443110ef0f8/bot.js
**Stack:** Node.js, discord.js v13, node-fetch; no database (fully stateless, single-file bot)
**License:** AGPL-3.0 (copyleft) — ideas only, no code reuse
**Last activity:** 2022-10-16 (pushed_at; last commit 2022-10-16T19:46:04Z)
**FRC team:** unknown (author "CMEONE" runs a hosted public instance at frcbot.togatech.org; no team number in repo)
**Areas:** communication, third-party integrations

## Purpose
A Discord bot that lets any FRC team's Discord server look up live The Blue Alliance (TBA) data — teams, events, matches, rankings, alliances, and awards — via chat commands, without leaving Discord.

## Auth & Roles
None. No user accounts, no permission tiers, no per-guild config. Any user in any server the bot is invited to can run any command; Discord's own invite/OAuth permission scopes are the only access control (set once at bot-invite time, not enforced by the bot's code).

## Data Model
None — no database, no persistence layer. All data is fetched live from the TBA REST API (`tba_url` in `config.json`, default `https://www.thebluealliance.com/api/v3`) on each command and rendered directly into a Discord embed. The only "state" is an in-memory `update_waiting`/`footer` flag used for the self-update-check banner.

## Features

### Communication (Discord bot / chat interface)
- Prefix-based command parser (default `.`) driving a single `messageCreate` handler / switch statement — `bot.js:117-1158`.
- `.help` — auto-generated embed listing every command and its argument syntax — `bot.js:175-239`.
- `.info` — bot metadata / invite link / source link embed — `bot.js:240-259`.
- Consistent red "Error" embed pattern for bad/missing arguments and upstream API failures across every command — e.g. `bot.js:262-268`, `bot.js:371-378`.
- Presence/status line showing `{prefix}help | frcbot.togatech.org`, re-affirmed every 60s via `setStatus()` — `bot.js:31-44`.
- Self-update-check: polls `https://frcbot.togatech.org/version` every 60s and prepends an "UPDATE AVAILABLE" notice to every embed footer when the hosted instance is newer than the running version — `bot.js:46-68`.
- DM support: falls back to `msg.author` as the reply channel when invoked outside a guild — `bot.js:152-154`.

### Third-party integrations (The Blue Alliance API)
- `.team {team_number}` — team profile: name, school, location/address (with Google Maps link), rookie year, motto, website — `bot.js:260-383`.
- `.event {event_key}` — event details: location/address, start/end dates, timezone, webcast links, website — `bot.js:384-509`.
- `.eventsearch {year} {terms...}` — free-text search across an entire season's events by name/location/city, with a "worlds" → "championship" alias — `bot.js:510-585`.
- `.teams {event_key}` — full team list registered for an event — `bot.js:586-631`.
- `.matches {event_key} {team_number}` — all matches for one team at an event, chronologically sorted, red/blue alliance rosters, Discord relative-timestamp formatting (`<t:...:R>`) — `bot.js:632-693`.
- `.match {event_key} {type} {set} {match}` — single-match detail: time, alliances, score breakdown, winner, video/webcast links — `bot.js:694-821`.
- `.alliances {event_key}` — elimination alliance draft results (captain + picks) — `bot.js:822-875`.
- `.playoffs {event_key} {?type}` — playoff-only match schedule, optionally filtered to eighths/quarters/semis/finals — `bot.js:876-945`.
- `.rankings {event_key}` — qualification rankings, rank-sorted — `bot.js:946-995`.
- `.awards {event_key}` — awards given at an event, sorted by award type, with per-team or named-individual recipients — `bot.js:996-1052`.
- `.teamawards {team_number}` — full award history for a team, sorted by year then award type — `bot.js:1053-1102`.
- `.teamevents {team_number}` — full event history for a team, most recent first — `bot.js:1103-1153`.
- Shared helpers: `matchOverview()` (comp-level → human label, `bot.js:89-101`), `formatWebcast()` (Twitch/YouTube/Livestream/direct-link → Markdown link, `bot.js:103-115`), `displayWebsite()` (strips protocol/trailing slash for display, `bot.js:81-87`).

## Integrations
The Blue Alliance (TBA) API v3 — the bot's sole external data source, authenticated via a per-instance `tba_key` read API key (`exampleconfig.json`). No Slack, email, SMS, Google, or Onshape integration.

## Notable Implementation Details
- Entire bot is one 1,159-line file (`bot.js`) with a single giant `switch` on the first whitespace-token of every message — no command framework, no slash commands (legacy prefix-only, pre-dates Discord's message-content-intent restrictions), no per-guild config (single global `config.json`).
- Every TBA call is a raw `fetch` + `.json()` with the API key passed as a query string (`?X-TBA-Auth-Key=...`) rather than a header — works but is unconventional and leaks the key into logs/URLs more easily.
- No caching/rate-limiting of TBA calls — a burst of commands in a busy server hits TBA once per command per user with no memoization, backoff, or shared cache.
- Self-update-notification pattern (`checkForUpdates()` polling a `/version` endpoint on the author's own hosted site) is a reusable idea for open-source self-hosted bots: nudge stale self-hosted instances without forcing telemetry.
- Extensive `?.` optional-chaining and manual field-presence checks to build embeds gracefully from TBA's inconsistently-populated fields (team address, motto, webcasts, etc.) is a good defensive-rendering pattern to copy.
- Bugs present in this pinned commit worth noting (not to replicate): `.team`'s "Motto" field references an undefined `motto` variable instead of `team.motto` (`bot.js:348`) — would throw/`ReferenceError` if a team has a motto; several `!= ""` checks against possibly-`null` fields (e.g. `team?.gmaps_url != ""`, `bot.js:324`) that don't actually guard against `null`.
- No tests, no CI config, no rate-limit or abuse handling — small hobby-scale codebase throughout.

## Verdict
Thin but relevant: a single-file, un-authenticated Discord command bot wrapping the TBA read API — good reference for the exact command surface (team/event/match/ranking/award lookups) and Discord-embed formatting patterns worth recreating, but there's no data model, no roles, and no team-specific customization to borrow beyond the command list and the self-update-check idea.

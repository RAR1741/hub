# BertBot — Source Survey

**Repo:** ngregrichardson/BertBot — https://github.com/ngregrichardson/BertBot
**Surveyed-at:** 5587bbabf25e1f73c7898606f201551c76999a5f
**Permalink form:** https://github.com/ngregrichardson/BertBot/blob/5587bbabf25e1f73c7898606f201551c76999a5f/<path>
**Stack:** Node.js (v8) + Express + discord.js v11 / discord.js-commando, lowdb (JSON file DB via `.data/db.json`), jQuery/vanilla-JS admin UI served as static HTML; designed to run on Glitch
**License:** `package.json` declares `"license": "ISC"` but there is **no LICENSE file** in the tree — ambiguous/unverifiable; treat as **ideas only**, do not copy code
**Last activity:** 2019-01-18 (repo `pushed_at`; single squashed history, no meaningful commit log beyond initial import)
**FRC team:** 4750 (per README: "BertBot was created for FRC team 4750 to use in their Discord server")
**Areas:** communication (Discord bot, notifications, moderation), third-party integrations (Trello, Gmail/IMAP, The Blue Alliance, Strawpoll, RapidAPI), parts ordering/POs (Trello-to-Gmail order-request workflow)

## Purpose
A self-hosted Discord bot for a single FRC team's server that combines chat moderation/utility commands with two team-ops integrations: mirroring Trello board activity into a Discord channel, and a lightweight "order request" pipeline that watches a Trello list for uploaded order forms and emails a mentor, then lets the mentor's email reply move the Trello card and check off a checklist item.

## Auth & Roles
- No user accounts of its own — identity is entirely Discord's (`message.member`, `message.author`, Discord role objects).
- Role gating is done in-command via `hasPermission(message)`, checking `message.member.roles.some(r => config.<roleList>.includes(r.name))` against two configurable name lists: `config.restrictedCommandRoles` (default `["owner","leader"]`) and `config.modCommandRoles` (default `["owner"]`). No numeric/DB-backed role model — just Discord role *names* matched at runtime, so renaming a Discord role silently breaks permissions.
- The web config UI (`ui/`) has no auth at all — `server.js` exposes `GET/POST /config` unauthenticated; anyone who can reach the Glitch-hosted URL can rewrite the bot's entire configuration.

## Data Model
- Single lowdb JSON file (`.data/db.json`) via `lowdb` + `FileSync` adapter, no relational schema. Top-level keys seeded in `server.js`:
  - `config` — one big JSON-stringified object (bot name, team number, Discord server/channel IDs, all feature toggles, Trello board/list/checklist names, role-name lists, per-user Discord-ID↔Trello-username map `userIDs`, etc.) — stored oddly as an object key (`{ '<json-string>': '' }`), unwrapped via `_.keys(...)`.
  - `commands` — custom text commands added via `!command add`.
  - `likes` — map of username → like count (đon reaction tracking).
  - `meetings` — JSON-stringified map of `"day-month-time"` → `{date fields, description}`.
  - `count` — unused counter.
  - `.latestActivityID` (flat file, not in lowdb) tracks the last-seen Trello activity ID for the polling watermark.
  - `swears.json` — static profanity word list loaded at boot.

## Features
**Communication (Discord)**
- Swear filter (`index.js` `bot.on('message', ...)`): scans each message word-by-word against `swears.json`, deletes offending messages, DMs the author with a redacted resend suggestion, and DMs the server owner a timestamped report of who said what where. Per-channel whitelist via `config.swearFilterWhitelistedChannelNames`.
- Meeting reminders (`commands/meetings/meeting.js`): `!meeting add|remove "description" day month time` stores meeting entries in lowdb; a separate scheduler (implied by `moment`/`node-schedule` deps) fires day-before notifications to a configured channel.
- Polls: `commands/polls/poll.js` posts a message and auto-reacts 👍/🤷/👎 for a lightweight yes/no/maybe vote; `commands/polls/strawpoll.js` calls the Strawpoll.me v2 API to create a real multi-option poll (2–31 options) and posts the link.
- Custom commands (`commands/custom/command.js`): `!command add <name> "description" "response"` dynamically **writes a new `.js` command file to disk** from string-concatenated JS templates and requires it in at runtime — a code-generation anti-pattern (see below).
- Spam channel toggle (`commands/spam/spam.js`): `!spam add|remove @user` swaps a hardcoded `student` Discord role for a hardcoded `spam` role, gated to the `student` role only.
- Like tracker (`commands/random/like.js`): counts 👍 message-reactions per author in lowdb, `!like count|top` renders a top-5 embed leaderboard.
- Moderation (`commands/mod/`): `ban.js`/`kick.js` (member removal), `role.js` (add/remove a named role from a user — note: buggy shadowed-parameter bug, `role.name == role` compares to the function's own `role` string param, not the loop variable), `channel.js` (create/remove text or voice channels by name), `restart.js` (mod-gated `process.exit()` to trigger a process-manager restart).
- Misc info/utility commands (`commands/info/`, `commands/random/`): `!kickoff` (countdown to FRC kickoff), `!whatis` (Wikipedia search via `wikijs`), `!feedback` (static link), `!advice`, `!blaise` (dad jokes via `dadjokes-wrapper`), `!flip`, `!mood`, `!pid` (joke command), `!winner` (joke command).

**Third-party integrations**
- Blue Alliance lookup (`commands/tba/tba.js`): `!tba <teamNumber>` calls `thebluealliance.com/api/v3/team/frc<n>` with a `TBAKEY` env var and renders team nickname/location/website/TBA-page as a Discord embed. Throttled to 1 use/60s.
- Trello activity mirror (`index.js`, using `trello-events` + polling with `latestActivityId` persisted to `.latestActivityID`): listens for ~15 Trello webhook-style events (card created, description/due-date/position/list/name changed, member added/removed, checklist added/removed, checklist item complete/incomplete toggled, attachment added/removed, comment added/edited, list created, card archived/unarchived/deleted) and posts a formatted Discord embed per event, with a per-event-type enable list (`config.enabledTrelloNotifications`) and Discord-user mention enrichment via a stored `config.userIDs` (Trello username → Discord ID) map.
- Order-request pipeline (`index.js` `addAttachmentToCard` handler + IMAP poller): when an attachment lands on a card in the configured "Orders Requested" Trello list, emails the mentor (`gmail-send`) with the form attached/linked; a separate `setInterval` IMAP poller (`imap-simple` against Gmail) scans the mentor's ARCHIVE folder for a reply from that same address, and on finding one moves the Trello card from "Orders Requested" to "Orders Placed" and checks off a named checklist item via the Trello REST API (raw HTTP through `rapidapi-connect`/direct calls, not the `trello` npm package consistently).
- Web admin UI (`ui/index.html`, `ui/settings.js`, `ui/meetings.js`): a static HTML/JS settings page that GETs/POSTs the entire `config` blob to `server.js`, letting a non-technical user toggle features and fill in IDs (Trello board ID, Discord channel/server IDs, checklist/list names, role-name lists, per-event Trello-notification checkboxes) without editing JSON by hand.

## Integrations
Discord (bot + slash-less prefix commands via discord.js-commando), Trello (REST + `trello-events` polling), Gmail (SMTP send via `gmail-send`, IMAP read via `imap-simple`), The Blue Alliance API v3, Strawpoll.me API v2, Wikipedia (`wikijs`), a joke API (`dadjokes-wrapper`), and RapidAPI (`rapidapi-connect`, used for the swear-filter/profanity-related calls per the `R1`/`R2` env vars).

## Notable Implementation Details
- **Runtime code generation as a feature**: `commands/custom/command.js` builds a full command class by string-concatenating JS source (`file1`...`file7`) and writing it to disk, then the bot presumably reloads/requires it. This is a real anti-pattern (arbitrary code execution surface, no sandboxing) worth explicitly avoiding in any re-implementation — a custom-command feature should be re-built as pure data (name → response template) interpreted at runtime, never as generated source files.
- **No authentication on the admin config endpoint** — `POST /config` in `server.js` accepts and persists any payload from anyone who can reach the URL. A re-implementation needs auth on any config-writing endpoint.
- **Config-as-one-JSON-blob** stored as an object *key* in lowdb (`{ '<json string>': '' }`) rather than a value — an unusual/fragile serialization choice; a real re-implementation should just store config as a normal typed record/table.
- **Permission model is name-string matching against live Discord roles**, not IDs — fragile to role renames, and the `role.js` command has a shadowing bug where the target role name is compared against itself rather than the guild's role list.
- **Polling-based external integrations throughout**: Trello activity via `pollFrequency` interval + `minId` watermark (not real webhooks) and Gmail replies via a `setInterval` IMAP scan of a folder — simple to reason about but adds latency and is a plausible model for a lower-effort "Trello → Discord" or "email-triggered PO status update" feature if a team doesn't want to stand up webhook receivers.
- Built for/pinned to old dependency majors (`discord.js` v11 uses the now-removed `RichEmbed`/`.get()` collection API, Node 8 engine) — none of the code is runnable as-is on current Discord.js or Node; only the feature concepts transfer.
- Self-ping `setInterval` hitting its own Glitch domain every ~4.7 minutes to prevent the free Glitch dyno from sleeping — a deployment-platform workaround, not relevant beyond historical context.

## Verdict
Thin-to-moderate: a single-team, single-maintainer 2019 Discord bot with real but small/single-file features; the two ideas worth stealing are the **Trello-card-attachment → mentor-email → email-reply-moves-card order-request loop** and the **Trello-activity-to-Discord notification mirror with a per-event toggle list and Trello-username↔Discord-ID mention enrichment** — both mapped to modern APIs/webhooks and with real auth added. The custom-command code-generation pattern and the unauthenticated config endpoint should be treated as anti-patterns to avoid, not features to copy.

# Dozer — Source Survey

**Repo:** https://github.com/FRCDiscord/Dozer (FRCDiscord)
**Surveyed at commit:** `704a6faed63ee93f8e0a39df5e84dbd9d81aa885`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/FRCDiscord/Dozer/blob/704a6faed63ee93f8e0a39df5e84dbd9d81aa885/<path>`

## Purpose

Dozer is a general-purpose Discord bot built and run by the (unofficial) FRCDiscord community for
FIRST-related Discord servers broadly — it is explicitly a **multi-guild, multi-team bot**: any
server can invite it, and its commands/config are all scoped per-guild (`guild_id` columns
everywhere). It is not a single team's internal tool; it is community infrastructure that happens
to run in many teams' Discords simultaneously (moderation, welcome flows, role self-service,
FRC/FTC team lookups via The Blue Alliance and The Orange Alliance, music, trivia/name games,
starboard, RSS/Reddit/Twitch feed posting, Q&A-forum lookup, etc.).

**Scope note for this survey:** per the task, only the pieces relevant to how a *single* team would
use Discord for its own operations are covered in depth (roles/verification, team info lookup,
moderation, notifications/logging, TBA integration). Sections below flag what is community-scale
plumbing (music, starboard, trivia/name games, RSS/Twitch/Reddit feed cogs, `firstqa` forum search)
that a single-team internal tool would skip entirely.

## Stack

- **Language:** Python (README targets 3.8+; no `pyproject`/`setup.py` — plain script layout).
- **Framework:** `discord.py` 2.3.0 (`requirements.txt`) — a Discord bot, not a web app. `dozer/bot.py`
  subclasses `commands.Bot`; commands are grouped into `discord.ext.commands.Cog` subclasses under
  `dozer/cogs/`, loaded dynamically (`dozer/__main__.py`).
- **Database:** PostgreSQL only, via `asyncpg` (no ORM). `dozer/db.py` defines a `DatabaseTable`
  base class with a manual migration system: each table subclass declares `__tablename__`,
  `__uniques__`, and a `__versions__` list of migration functions; `db_migrate()` walks
  `DatabaseTable.__subclasses__()` at startup, creates missing tables via `initial_create()`, and
  runs any un-applied `__versions__[i]` step, tracked in a `versions` table. No Alembic/Sequel — it's
  hand-rolled.
- **Key libraries:** `discord.py[speed,voice]`, `asyncpg`, `aiotba`/`tbapi` (Blue Alliance), `googlemaps`,
  `geopy`, `fuzzywuzzy`, `sentry-sdk`, `loguru`, `humanize`, `rstcloth` (docs generation from
  docstrings), `bs4`. Lavalink (external Java process, via Docker Compose) powers the music cog.
- **Frontend:** none — Discord slash/prefix commands and embeds are the entire UI. `dozer/context.py`
  defines a `DozerContext` wrapping `commands.Context` (adds `.defer()` handling for
  interaction-based replies vs. plain messages).
- **License:** GPL-3.0 (`LICENSE`, GNU GPL v3, no copyright header filled in). Strong copyleft — code
  reuse (not just feature-recreation) would require matching licensing; this repo confirms the
  no-code-copy rule matters here.
- **Deployment/hosting:** Docker Compose (`docker-compose.yml`) bundling the bot + a Lavalink
  container; CI badge in README points to GitHub Actions running pylint (contributors must hit a
  100% pylint score, enforced via `pre-commit`). No hosted/managed instance implied by this repo —
  each community/team is expected to run its own bot process with its own token.

## Auth & Roles

There is no username/password auth model — "auth" here means **Discord-native permission gates**
per command, keyed off the invoking member's guild roles/permissions, not an app-level user table.

- **Permission decorators** — `discord.ext.commands.has_permissions(...)` gates commands by the
  Discord guild permission the *caller* holds (e.g. `kick_members`, `manage_roles`, `manage_guild`,
  `manage_messages`, `manage_permissions`), and `bot_has_permissions(...)` checks the *bot's own*
  role has the Discord permission needed to execute the action (e.g. `manage_roles`,
  `manage_permissions`) — both imported from `dozer/cogs/_utils.py` / `discord.ext.commands`. Used
  throughout `moderation.py`, `roles.py`, `actionlogs.py`.
- **Developer allowlist** — a `developers` list of Discord user IDs in `config.json` gets elevated
  bot-owner-style access to developer-only commands (`dozer/cogs/development.py`, not surveyed in
  depth — it's bot-operator tooling, not team-ops).
- **Role-hierarchy checks in code** — several commands additionally enforce that the caller/bot
  cannot grant or remove a role above their own top role (`roles.py` `give`/`take`/`tempgive`/
  `addrole`: `if role > ctx.author.top_role: raise BadArgument(...)`), mirroring Discord's own rule
  but pre-empting the API error with a friendlier message.
- **"New member" verification gate** (`moderation.py` `Moderation.nm_kick_internal`, `nmconfig`,
  `verifymember`, `nmpurgeconfig`) — a per-guild configured role + channel + message: members who
  haven't been granted a "verified" role within a configured number of days are auto-kicked
  (`nm_kick` scheduled task); `verifymember` command manually grants the role early;
  `on_member_join` posts the configured verification message.
- **Member role config** (`MemberRole` table, set via `memberconfig`) — designates which guild role
  represents "verified member," referenced by `timeout` (falls back to permission-overwriting every
  role below the caller if unset) and by `roles.py`'s join-restore logic (prioritizes restoring the
  member role first).
- **Everything is per-guild-scoped**, not per-team: there is no concept of "this Discord server is
  team 1741" baked into auth — `teams.py` (below) is an opt-in, per-*user* self-reported association,
  not a verified roster link.

## Data Model

All tables are Postgres, defined as `DatabaseTable` subclasses colocated with the cog that owns
them (not a central schema file). Team-ops-relevant tables:

- **`TeamNumbers`** (`dozer/Components/TeamNumbers.py`) — `(user_id, team_number, team_type)`
  composite PK; a user can self-associate with any number of FRC/FTC teams via `setteam`. No
  verification — purely user-asserted.
- **`AutoAssociation`** (`dozer/cogs/roles.py`) — `guild_id` PK, `team_on_join` bool: whether the bot
  auto-appends a member's sole team association to their nickname on join.
- **`GiveableRole` / `RoleMenu` / `ReactionRole`** (`roles.py`) — self-serve role catalog
  (`role_id` PK, normalized name) plus reaction-role message bindings (`message_id, role_id` PK)
  and named "menus" grouping multiple reaction-role entries into one embed.
- **`MissingRole` / `TempRoleTimerRecords`** (`roles.py`) — roles stashed when a member leaves (for
  restore-on-rejoin) and scheduled temporary-role-removal timers.
- **`Mute` / `Deafen` / `PunishmentTimerRecords` / `GuildModLog` / `CrossBanSubscriptions` /
  `MemberRole` / `NewMemPurgeConfig` / `GuildNewMember` / `GuildMessageLinks`**
  (`dozer/cogs/moderation.py`) — punishment state and per-guild moderation config (mod-log channel,
  new-member verification settings, cross-guild ban subscription list).
- **`NicknameLock` / `GuildMessageLog`** (`dozer/cogs/actionlogs.py`) — locked nicknames (member
  cannot rename themselves away from a locked value) and per-guild message/member-log channel
  config (join/leave templates, ping-on-join toggle, nickname-change and bulk-delete logging).
  `GuildNewMember.version_1` shows the versioned-migration pattern in practice (adds a
  send-on-verify column to an existing table).
- **`ScheduledMessages`** (`dozer/cogs/management.py`) — one-off future-dated messages a mod
  schedules to a channel (`schedulesend add/list/delete`), delivered by a background timer task
  registered at cog load (`msg_timer`).
- **`ModmailConfig` / `ModmailThreads`** (`dozer/cogs/modmail.py`) — per-guild modmail target
  channel and open DM↔thread mappings.

No foreign keys between tables (asyncpg raw SQL, no ORM relations) — every join is done in Python
after separate `get_by()` calls.

## Features

Grouped by relevance; **(community-scale — skip for a single-team tool)** marks cogs/features that
only make sense for a bot serving many unrelated guilds.

### Team association & lookup (`dozer/cogs/teams.py`, `dozer/Components/TeamNumbers.py`)
- **Self-report a team association** — `setteam <frc|ftc> <number>` lets any member claim
  membership on any number of teams; `removeteam` undoes it. `dozer/cogs/teams.py`.
- **List a user's teams** — `teamsfor [member]`. `dozer/cogs/teams.py`.
- **List members on a team** — `onteam <type> <number>` embeds every guild member who self-reported
  that team. `dozer/cogs/teams.py`.
- **Top teams in a guild** — `onteam_top` — top 10 teams by member count among current guild
  members. `dozer/cogs/teams.py`.
- **Competition attendance check** — `compcheck <frc|ftc> <event_key>` cross-references an
  event's registered teams (via TBA for FRC, TOA for FTC) against `TeamNumbers` to show which
  server members are attending, paginated across embeds. `dozer/cogs/teams.py`.
- **Auto-append team to nickname on join** — toggle via `toggleautoteam`
  (`has_permissions(manage_guild=True)`); on join, if a member has exactly one team association and
  the bot can manage nicknames, appends e.g. `" frc1741"` to their display name (truncated to 32
  chars). `dozer/cogs/teams.py` `on_member_join`, `AutoAssociation`.

### FRC team info via The Blue Alliance (`dozer/cogs/tba.py`)
- **`tba team <num>`** — full team profile embed (name, location, rookie year, website) from TBA.
- **`tba eventsfor <num> [year]`** — a team's events for a season.
- **`tba media <num> [year]`** — team media (robot photos/videos) for a season.
- **`tba awards <num> [year]`** — awards won.
- **`tba raw <num>`** — raw TBA API JSON dump for a team (debugging aid).
- **`weather <frc|ftc> <num>`** — current weather at a team's registered location via Google Maps
  geocoding + a weather API.
- **`timezone <frc|ftc> <num>`** — a team's local time via geocoding + `timezones.json` lookup.

### Self-service roles (`dozer/cogs/roles.py`)
- **`giveme <role[,role...]>`** — self-assign one or more pre-approved "giveable" roles from a
  comma list; reply gets a ❌ reaction to undo within 30s. Auto-purges roles that no longer exist
  in the guild before running.
- **`giveme add/create/delete/removefromlist/list`** — admin (`manage_guild`/`manage_roles`)
  management of the giveable-role catalog; `add` reuses an existing same-named role, `create`
  always makes a new one, `delete` also deletes the underlying Discord role, `removefromlist` only
  un-lists it.
- **`give` / `take` / `tempgive`** — mod-only grant/revoke of *any* role (not just giveable ones),
  with a hierarchy check against the caller's top role; `tempgive` schedules automatic removal
  after a duration string (`1h`, `2d`, etc.) via `TempRoleTimerRecords` + an asyncio sleep-based
  timer restored on bot restart.
- **Reaction-role menus** — `rolemenu` group: `createmenu` posts a blank embed in a channel;
  `addrole`/`delrole` binds/unbinds a role to an emoji reaction on a message (menu or arbitrary
  message), live-updating the menu embed's field list; base `rolemenu` command lists all tracked
  menus and any "unbound" reaction-role entries not attached to a generated menu.
- **Role persistence across leave/rejoin** — on member leave, all their roles are stashed
  (`MissingRole`); on rejoin, restorable roles (existing, at/below the bot's top role) are
  reapplied automatically, with an embed reporting any that couldn't be restored (deleted, or above
  bot's reach) posted to the configured member-log channel.
- **Role rename/delete sync** — guild role rename/delete events keep the `GiveableRole` catalog's
  stored name in sync or purge the entry.

### Moderation (`dozer/cogs/moderation.py`)
- **`warn`** — posts a warning entry to the mod-log channel without any punishment action.
- **`customlog`** — freeform mod-log entry with custom text (arbitrary annotations).
- **`ban` / `unban` / `kick`** — standard actions, each writing a mod-log entry via a shared
  `mod_log()` helper (actor, action, target, reason, DM-the-target-if-possible).
- **`mute` / `unmute` / `deafen` / `selfdeafen` / `undeafen`** — role-based mute (adds a
  configured "Muted" role) and voice-deafen, both schedulable via a duration argument
  (`punishment_timer` background task, restored on restart via `restart_all_timers`/
  `start_punishment_timers`); `selfdeafen` lets a member deafen themselves (e.g. focus mode).
- **`voicekick`** — disconnects a member from voice.
- **`timeout <seconds>`** — locks the *current channel* (not the member) by stripping
  send/react permission overwrites from the member role (or, if unconfigured, every role below the
  caller) for a duration, auto-restoring the prior overwrites afterward.
- **`prune`/`purge <target?> <num>`** — bulk-delete the last N messages in the channel, optionally
  filtered to one member's messages, or delete-through-a-given-message-ID.
- **`punishments`** — lists all active mutes/deafens (incl. self-deafens) in the guild.
- **`purgenm`** — kicks all "new members" past their verification deadline immediately (manual
  trigger for the scheduled `nm_kick`).
- **`modlogconfig` / `nmconfig` / `nmpurgeconfig` / `memberconfig` / `linkscrubconfig`** — per-guild
  setup: mod-log channel, new-member verification role/channel/message/grace-period, the
  guild's "member" role, and a role exempt from the link-scrubbing auto-filter.
- **`verifymember`** — manually grants the verification role early (skips the new-member timer).
- **Link-scrubbing auto-moderation** — `on_message`/`on_message_edit` check messages against a
  role-based allowlist and can warn/strip messages containing links from non-exempt members
  (`_check_links_warn`, `check_links`).
- **Cross-server ban subscriptions** — `crossbans` group (`view_subs`/`subscribe`/`unsubscribe`):
  a guild can subscribe to another guild's ban list so a ban in guild A auto-applies (`run_cross_ban`)
  in subscribed guild B on `on_member_ban`. **(community-scale — a single team has one Discord and
  no peer guilds to federate bans with; skip.)**
- **`say_the_line`** — a joke/meme command with no operational purpose. **(skip.)**

### Logging & member-flow notifications (`dozer/cogs/actionlogs.py`)
- **Join/leave embeds** — customizable templated messages (`setjoinmessage`/`setleavemessage`,
  supporting placeholders) posted to a configured member-log channel, with an optional
  "@here"-style ping toggle (`toggleping`) and a toggle to only post the join message once a member
  passes verification rather than immediately (`togglesendonverify`).
- **Message edit/delete logging** — logs edits and deletions (single and bulk) to a configured
  message-log channel, using the audit log where possible to attribute deletions to a specific
  moderator (`check_audit`).
- **Nickname-change logging + nickname lock** — logs nickname changes; `locknickname`/
  `unlocknickname` pin a member's nickname so any self-initiated change is silently reverted
  (`check_nickname_lock`, `on_member_update`).
- **Member ban logging** — logs bans (including cross-guild-triggered ones) to the mod log.
- **`messagelogconfig` / `memberlogconfig` group (`viewconfig`/`setchannel`/.../`disable`/`help`)**
  — per-guild setup and inspection of the above.

### Scheduled announcements (`dozer/cogs/management.py`)
- **`schedulesend add <channel> <time> <content>`** — schedule a one-time future message to a
  channel; `list`/`delete` manage pending sends; delivery via a background timer restored at cog
  load. Useful for "meeting reminder tomorrow at 6pm" style team announcements without a full
  calendar system.

### Modmail (`dozer/cogs/modmail.py`)
- **DM-to-staff-channel bridge** — a member DMs the bot (or clicks a "Start Modmail" button /
  fills a modal) and it opens/continues a thread in a configured staff channel; staff `reply` in
  the thread relays back to the member's DMs; `modmail_close` ends a thread.
  `configure_modmail` sets the target channel; `create_modmail_button` posts a persistent button.

### Server/member info (`dozer/cogs/info.py`, `dozer/cogs/general.py`)
- **`member`/`user`/`memberinfo`/`userinfo [member]`** — profile embed (join date, roles, status,
  activity, permissions).
- **`role <role>`** — role detail embed; **`rolemembers <role>`** — lists members holding it.
- **`server`/`guild`/`guildinfo`/`serverinfo`** — guild stats embed.
- **`stats`** — bot-wide stats (guild count, uptime, latency).
- **`ping`** — latency check. **`nick`** — self-service nickname change. **`invite`** — bot invite
  link. **`configprefix`/`setprefix`** — per-guild command-prefix override.
- **`help`/`about`** — generated command reference (whole bot, one cog, or one command), built
  from each command's `example_usage` string convention used throughout every cog.

### Not team-ops — community-scale plumbing (present in the repo, out of scope for a single team)
- **Music** (`dozer/cogs/music.py`, referenced via Lavalink in `docker-compose.yml`) — full voice
  music player; irrelevant to team operations.
- **Starboard** (`dozer/cogs/starboard.py`) — cross-channel "pin popular messages" board; a
  community-engagement feature for large public servers, not a team tool.
- **Name game / trivia** (`dozer/cogs/namegame.py`) — FRC-team-name guessing game; entertainment.
- **RSS / Reddit / Twitch feed posting** (`dozer/sources/`, `dozer/cogs/news.py`) — auto-posts new
  blog/subreddit/stream content to a channel; built for public FIRST-community servers aggregating
  external content, not a single team's internal ops.
- **`firstqa` FTC/FRC forum Q&A search** (`dozer/cogs/firstqa.py`, `ftcqa.py`, `ftc_teams.pickle.gz`)
  — searches the official Q&A forums/rules; a reference tool useful to any FIRST participant, not
  specific to running one team.
- **`polls`, `fun`, `voice` (temp voice channels), `profile_menus`, `filter` (word filter),
  `shortcuts`, `levels` (XP/leveling)** — general Discord-community-bot features (engagement,
  gamification, generic word filtering) with no FRC-team-operations content.
- **`ftc.py`** — FTC-specific team/event lookups paralleling `tba.py` for FRC; relevant only to FTC
  teams, so a survey for an FRC team's hub would skip it (documented here as a `tba.py` sibling, not
  detailed further).

## Integrations

- **The Blue Alliance API** (`aiotba`/`tbapi`) — FRC team/event/media/award data. `dozer/cogs/tba.py`.
- **The Orange Alliance API** — FTC team/event data, used by `compcheck` and `ftc.py`.
- **Google Maps Geocoding API** (`googlemaps`) — resolves a team's registered location for
  `weather`/`timezone`. `dozer/cogs/tba.py`.
- **A weather API** (via geocoded coordinates) for `weather`. `dozer/cogs/tba.py`.
- **Lavalink** (external Java audio-streaming server, Docker-composed) — powers the music cog.
  **(skip for team-ops.)**
- **Reddit / Twitch / generic RSS** (`dozer/sources/RedditSource.py`, `TwitchSource.py`,
  `RSSSources.py`) — feed-polling sources for `news.py`. **(skip for team-ops.)**
- **Sentry** (`sentry-sdk`) — error tracking, configured at startup.
- **Discord** itself — the entire surface (slash commands, message components/buttons/modals for
  modmail, reaction events for role menus).

## Notable Implementation Details

- **Hand-rolled versioned migrations, not Alembic/Sequel-style timestamped files.** Each
  `DatabaseTable` subclass carries its own `__versions__` list of bound methods; `db_migrate()`
  diffs a per-table `versions` row against `len(__versions__)` and replays only the missing steps.
  A re-implementer copying this pattern should note it has no down-migrations and no dry-run.
- **No FK constraints anywhere** — every relation (e.g. `ReactionRole.message_id` ↔
  `RoleMenu.message_id`) is enforced only by matching application-level queries; deletes don't
  cascade and orphans are possible (e.g. deleting a `RoleMenu`'s Discord message doesn't clean up
  `ReactionRole` rows except via the `on_raw_message_delete` listener explicitly doing so).
- **All state is per-`guild_id`, none of it is "this Discord = this one team."** There's no config
  key anywhere binding a guild to a single canonical team number; `teams.py`'s `TeamNumbers` is a
  member-level, self-asserted, unverified many-to-many table. A from-scratch single-team tool would
  invert this: one canonical team identity, verified membership, not opt-in self-report.
  `AutoAssociation`'s "exactly one team" nickname logic is a workaround for that same absence of a
  canonical team-guild binding. There is no per-user account/session concept, no password, no
  email — identity is entirely the Discord user ID, and "permissions" are Discord's own role-based
  permission bits, not an app-level role table (contrast with `cheesy-parts`'s
  readonly/editor/admin `User.permission` column).
- **Reaction-role add/remove is symmetric and generic** — the same `on_raw_reaction_action` handler
  serves both add and remove for every reaction-role entry in every guild; a bot restart does not
  lose role bindings (persisted in Postgres) but does need `on_ready` to re-arm in-memory timers
  (`TempRoleTimerRecords`, punishment timers) since those live only as asyncio tasks.
- **Pylint-100%-required contribution bar** (`README.md`, `pylintrc`, `.pre-commit-config.yaml`,
  CI) — unusually strict for a community bot; worth noting as a process artifact, not a feature.
- **No test suite** beyond `ci/ci.sh` running pylint — no unit/integration tests found in the repo.
- **Last activity / liveliness:** most-recently-touched file (`dozer/cogs/development.py` per `git
  log`) is dated `Thu Aug 6 2026`, and the repo carries an active CI badge, versioned migrations
  still being added (`version_1` methods), and a maintained `docs/` Sphinx tree — this reads as an
  actively maintained, currently-run community bot, not an abandoned one.

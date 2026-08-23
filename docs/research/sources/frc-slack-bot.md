# FRC Slack Bot — Source Survey

**Repo:** andrewda/frc-slack-bot — https://github.com/andrewda/frc-slack-bot
**Surveyed-at:** 8c7665b6151e0c73c71a2b3b8a6e0687af90c36e
**Permalink form:** https://github.com/andrewda/frc-slack-bot/blob/8c7665b6151e0c73c71a2b3b8a6e0687af90c36e/<path>
**Stack:** Node.js (>=4.0), `@slack/client` RTM/Web API, `fs-extra`, `node-schedule`, `thebluealliance` npm client, `weather-gov-graph-parse`. No database — all state is in-memory/ephemeral, config via a single `config.json` file.
**License:** MIT (declared in `package.json`; no separate LICENSE file in the tree) — safe to reference/reimplement ideas, low risk either way.
**Last activity:** 2016-09-25 (single commit history area, repo pushed_at 2016-09-25T19:22:55Z)
**FRC team:** South Eugene Robotics Team (README credits them by name; not explicitly numbered in-repo, but this is FRC team 1721)
**Areas:** (4) communication — this is purely a Slack chat-ops bot. Touches (3) third-party integrations only incidentally (TheBlueAlliance API, weather.gov).

## Purpose
A minimal, plugin-based Slack bot framework for an FRC team's Slack workspace, giving members chat commands for things like team lookups (via The Blue Alliance), weather-based shop-clothing reminders, polls, and message moderation — instead of building a full app, it's a lightweight always-on bot process.

## Auth & Roles
None. Single shared Slack RTM bot token in `config.json` (`slack.token`, `slack.botid`); no per-user roles, no permission checks on commands — any Slack user who can message the bot/channel can invoke any plugin (e.g. `Remove` plugin lets anyone whose reaction matches `remove_reaction` delete a message).

## Data Model
None persisted. Everything is transient in-process state:
- `plugins` and `listeners` are `Map`s built at boot by scanning the `plugins/` and `listeners/` directories (`bot.js`).
- Poll "state" is reconstructed by re-parsing the poll message's own text/reactions each time (`plugins/poll.js`) rather than stored anywhere — the Slack message itself is the database.
- Config is a flat JSON file (`config.ex.json`) with global settings (`prefix`, `requireMention`, `slack.token/botid`) and a `plugins.<PluginName>` bag for per-plugin settings (e.g. weather's `meeting_days`, `update_hour`, `channel`; remove's `remove_reaction`).

## Features

### Communication (area 4)
- **Convention-over-configuration plugin system** — any file dropped in `plugins/` is auto-loaded at boot, matched by filename to command name; each plugin exports a `config` (name/description/command/syntax/test) and a `main(plugin, events)` entry point. `bot.js`, `README.md`
- **Command parsing & syntax validation** — a shared `listeners/message.js` intercepts every RTM `message` event, strips the bot mention if `requireMention` is set, matches the configured command prefix (`!`), validates argument count against `<required>`/`[optional]` syntax tokens, and auto-replies with a usage message on mismatch. `listeners/message.js`, `lib/index.js` (`testCommand`, `testSyntax`, `getSyntaxMessage`)
- **Auto-generated help/command list** — `!help` enumerates all loaded plugins with a `command`+`description` and prints a formatted list. `plugins/help.js`
- **Echo command** — trivial reference plugin showing the minimal plugin shape. `plugins/echo.js`
- **Emoji-based moderation ("Remove")** — reacting to any message with a configured emoji (e.g. `:x:`) triggers `chat.delete` on that message; no permission gate on who can react. `plugins/remove.js`
- **Reaction-driven polls** — `!poll <question>` posts a formatted poll message; users vote via `:+1:`/`:-1:` reactions; a `reaction_added`/`reaction_removed` listener re-fetches the message + its reaction counts via `web.reactions.get` and rewrites the message text via `web.chat.update` to show live tallies. State lives entirely in the Slack message, no separate vote store. `plugins/poll.js`
- **Scheduled + on-demand weather reports** — `!weather [lat] [lon]` fetches next-day forecast high from weather.gov and replies with a shop-safety note ("long pants required" below 85°F); also runs on a `node-schedule` cron rule (configurable `meeting_days` + `update_hour`) to auto-post to a configured channel without a command. `plugins/weather.js`

### Third-party integrations (area 3, incidental to the chat-ops purpose)
- **TheBlueAlliance team lookup** — `!team <teamid>` calls the `thebluealliance` npm client and replies with nickname, motto, location, rookie year, and website. `plugins/tba.js`
- **weather.gov integration** — via `weather-gov-graph-parse`, hardcoded to a lat/lon default (Eugene, OR area) unless overridden by command args. `plugins/weather.js`

## Integrations
- Slack (RTM + Web API client, `@slack/client`) — the entire bot's transport layer.
- TheBlueAlliance API (via `thebluealliance` npm package) — team info lookups.
- weather.gov (via `weather-gov-graph-parse`) — forecast data, no API key required.
- No email/SMS/Google/Discord/Onshape integration.

## Notable Implementation Details
- **Plugin/listener discovery via filesystem scan + filename convention**: `bot.js` does `fs.readdirSync` on `plugins/` and `listeners/` at startup and `require()`s every `.js` file found, keying listeners by filename (must match the Slack RTM event type name) and plugins by their declared `config.name`. Zero manifest/registry file — the directory listing *is* the registry. Simple to extend (drop a file in), but no validation, no dependency ordering, no error isolation (a throwing plugin file crashes the whole boot).
- **`this`-binding trick for listeners**: custom listeners are invoked with `listener.call(self, message)` from inside `lib/index.js`, so listener code accesses `this.config`, `this.rtm`, `this.events`, etc. — an implicit-context pattern that's easy to break if a listener is ever called any other way.
- **No persistence layer at all** — this is the single biggest limitation for reuse: polls, moderation config, and command history all live only in Slack's own message/reaction state or in-process memory. A prod-grade reimplementation for team ops would need to decide deliberately what (if anything) needs a real DB (e.g. audit log of moderation actions, poll results export).
- **Single shared bot token, no scoping** — one RTM connection for the whole bot process; every plugin gets the same `web`/`rtm` client instance, so there's no way to scope one plugin's Slack permissions differently from another's.
- **Scale/robustness limits**: synchronous `fs.readdirSync` at boot only (no hot-reload of plugins); no retry/backoff around the Slack RTM connection; weather scheduling is naive (fixed lat/lon fallback embedded in code, not fully wired to config in the scheduled path — the scheduled job ignores the lat/lon args, always using the Eugene default).
- Uses the (now-deprecated) Slack RTM API and `@slack/client` v3, both long superseded by Slack's Bolt/Events API + Web API SDKs — this is 2016-era Slack integration code, useful only as a conceptual reference for the plugin architecture, not as an integration-code source.

## Verdict
Thin but genuinely relevant as a design reference: the only substantive idea worth reusing is the **filesystem-convention plugin/listener architecture** (drop-in command files auto-discovered and auto-wired to Slack events, with built-in syntax validation and auto-generated help) — everything else (poll-via-reaction-state, weather-triggered shop reminders, TBA lookup) is a thin, single-file plugin with no persistence, no auth, and stale Slack API usage; not worth copying code, only the plugin-registration pattern and the "reaction as UI state" trick for polls.

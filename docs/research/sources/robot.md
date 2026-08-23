# RoBot (erikboesen/robot) — Source Survey

**Repo:** erikboesen/robot — https://github.com/erikboesen/robot
**Surveyed-at:** 448f237f3e211360634d016dc6f99bbe95037a96
**Permalink form:** https://github.com/erikboesen/robot/blob/448f237f3e211360634d016dc6f99bbe95037a96/<path>
**Stack:** Node.js, `discord.js` (old pre-rewrite API — `bot.loginWithToken`, `message.mentions[0]`, `bot.memberHasRole`)
**License:** Root repo (`RoBot`) is MIT, copyright "FRCDiscord". However the root contains no actual bot code — the only real code lives in two unrelated sub-projects with their own licenses: `HydroBot/` is MIT (copyright Tom Orth), `AsianBot/` is **GPLv3** (copyleft — ideas only for that subfolder).
**Last activity:** 2016-08-31 (single commit era; repo is a 2016 snapshot, effectively abandoned)
**FRC team:** unknown — repo is credited to "FRCDiscord" org/handle but nothing in the code references a specific team number
**Areas:** communication (nominally) — in practice the repo delivers none of the six in-scope areas with FRC-specific substance

## Purpose
The root README states only "RoBot — The FRC Discord Bot," implying a Discord bot for FRC team communication. In reality the repo root has no bot implementation at all — it's an empty shell (README + LICENSE) wrapping two unrelated, generic experimental Discord bots (`HydroBot`, `AsianBot`) that have no FRC-specific logic, team roster integration, or event awareness.

## Auth & Roles
`HydroBot` plugins (`HydroBot/plugins/ban.js`, `kick.js`, `mute.js`, `unmute.js`) gate moderation actions on possessing a Discord server role literally named `'Bot Commander'` (checked via `bot.memberHasRole(...)`), and mute/unmute depend on a manually pre-created `'muted'` role. This is a generic Discord moderation permission pattern, not an FRC-specific role model (no mentor/student/admin distinction, no team-roster tie-in). `AsianBot` has no visible auth logic in the surveyed files.

## Data Model
None. No database, no persistence layer, no schema — the bot holds all state in-memory (a `Map` of loaded plugin modules in `HydroBot/bot.js`) and reads config only from environment variables (`process.env.HYDRO_TOKEN`).

## Features
Communication (generic Discord utility/moderation, not FRC-specific):
- Prefix-based command dispatch (`hey hydro, <cmd> <args>`) loading each plugin from a directory as an independent module — `HydroBot/bot.js`
- Kick/ban/mute/unmute moderation commands gated on a Discord role — `HydroBot/plugins/kick.js`, `HydroBot/plugins/ban.js`, `HydroBot/plugins/mute.js`, `HydroBot/plugins/unmute.js`
- Meme-image templating (reaction-image style responses using a bundled JPG template set) — `HydroBot/plugins/meme.js`, `HydroBot/plugins/templates/`
- Text translation command, presumably via a third-party translate API — `HydroBot/plugins/translate.js`
- Web lookup/scraper-backed command (Google/YouTube scraping) — `HydroBot/plugins/lookup.js`, `HydroBot/scrapers/google.js`, `HydroBot/scrapers/youtube.js`
- Static help text — `HydroBot/plugins/help.js`, `HydroBot/plugins/help.txt`
- `AsianBot/` provides only a `bot.js` and `commands.json` command table; contents are minimal/placeholder and GPLv3-licensed, so even as inspiration they carry copyleft — treat as ideas-only if referenced at all.

No time/attendance, roster/people-management, parts-ordering, part-design/manufacturing-tracking, or third-party FRC-integration (TBA, Onshape, etc.) features exist anywhere in the tree.

## Integrations
None relevant to FRC team-ops. `HydroBot` scrapes Google and YouTube for its lookup command (`HydroBot/scrapers/google.js`, `HydroBot/scrapers/youtube.js`) and likely calls an unspecified translation API in `translate.js` — these are generic web-utility integrations, not team-management integrations (no TBA, Onshape, Slack, email, or roster-system hooks).

## Notable Implementation Details
- The repo is a "team name in the URL, empty at the root" trap: `gh api .../git/trees` shows the root holds only `README.md` and `LICENSE`; all code sits in two independently-licensed, seemingly unrelated sub-bots that don't reference each other or an FRC team. Anyone surveying by root README alone would over-credit this repo.
- Uses the pre-2017 `discord.js` API (`loginWithToken`, `.mentions[0]`, `server.roles.get('name', ...)`) which was removed in later discord.js majors — none of the code is runnable against modern discord.js without a rewrite.
- Plugin loading is a naive `fs.readdirSync` + `require` loop with no error boundary per plugin (`HydroBot/bot.js`) — one bad plugin file throws at startup.

## Verdict
Thin/marginal — the repo's advertised premise ("FRC Discord Bot") is not backed by any FRC-specific or team-ops code; it's an abandoned 2016 shell around two generic, unrelated Discord bot experiments (one GPLv3). Nothing here is worth adopting into the roadmap beyond the generic idea "role-gated moderation commands in a team Discord," which is already commodity knowledge. Recommend excluding from further comparison.

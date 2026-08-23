# FRC Calendar Sync (frc-calendar-to-ical) — Source Survey

**Repo:** techplexengineer/frc-calendar-to-ical — https://github.com/techplexengineer/frc-calendar-to-ical
**Surveyed-at:** 0ad66c45b5e99f57eaf8cf515521dcdb44a28d02
**Permalink form:** https://github.com/techplexengineer/frc-calendar-to-ical/blob/0ad66c45b5e99f57eaf8cf515521dcdb44a28d02/<path>
**Stack:** JavaScript (ES modules), single Cloudflare Worker, `wrangler` for dev/deploy; no database, no frontend
**License:** none (all rights reserved) — no LICENSE file present in the repo; ideas only
**Last activity:** 2026-06-25 (single-commit/short-history repo; `pushed_at` 2026-06-25T20:04:19Z)
**FRC team:** likely 4909 (homepage `https://frc-calendar.team4909.org`), not stated in code/README
**Areas:** (3) third-party integrations, (4) communication

## Purpose
A tiny serverless proxy that scrapes the official FIRST Robotics Competition calendar page, converts the season's key-dates events (kickoff, registration windows, ship dates, event weeks, etc.) into a standard iCalendar feed a team can subscribe to in Google/Apple/Outlook calendars, and separately posts a weekly digest of that week's events to Slack.

## Auth & Roles
None. It is a public, unauthenticated Worker endpoint — no login, no API keys for callers, no user accounts. The only "secret" is a Cloudflare Worker environment variable (`SLACK_WEBHOOK_URL`) used server-side to post to Slack.

## Data Model
No persistent data store. Everything is computed on-request or on-schedule from the live FIRST Inspires HTML page; the Cloudflare edge Cache API (`caches.default`) is used purely as an HTTP response cache (keyed by request URL), not as a data model. In-memory only, per-request:
- `event` objects: `{ title, description, startStr, endStr, location, ctz, gcalUrl }` parsed from each calendar "lightbox" on the source page.

## Features
### Third-party integrations
- **Scrape-and-normalize official FIRST calendar into iCal** — fetches `firstinspires.org/programs/calendar?...program=frc`, uses Cloudflare's streaming `HTMLRewriter` to pull structured data out of each event's lightbox modal (title, description, programs, categories, "Add to Google Calendar" link) and filters down to only FRC-tagged events (`src/index.js`, `parseFrcEvents`).
- **Google Calendar URL parsing as the real data source** — rather than scraping displayed dates directly, it decodes the site's own "Add to Google Calendar" link (`dates`, `text`, `location`, `ctz`, `details` query params) to get authoritative start/end/timezone data, including all-day vs. timed event handling (`src/index.js`, `parseGcalUrl`).
- **"Opens"/"closes" title heuristic for point-in-time deadlines** — events whose title ends in "opens" or "closes" (e.g. registration windows) are converted from a single instant into a synthetic one-day (or point) range so they render sensibly on a calendar (`src/index.js`, inside `parseFrcEvents`'s lightbox `onEndTag` handler).
- **RFC 5545-compliant ICS generation** — builds `VCALENDAR`/`VEVENT` blocks with stable UIDs (slugified title + start/end), `DTSTART`/`DTEND` with `TZID` for timed events vs. `VALUE=DATE` for all-day events, text escaping, and 75-octet line folding (`src/index.js`, `generateICal`, `foldLine`, `escapeICalText`, `slugify`).
- **Edge caching with manual bypass** — successful responses are cached at Cloudflare's edge for 1 hour (`Cache-Control: public, max-age=3600`) via `ctx.waitUntil(cache.put(...))`; a `?bypass=true` query param skips both cache read and write, for debugging/forcing a refresh without polluting the cache (`src/index.js`, `fetch` handler).
- **JSON export mode** — `?format=json` returns the parsed event array directly instead of ICS, useful for debugging or downstream consumption (`src/index.js`).

### Communication
- **Weekly Slack digest via Cloudflare Cron Trigger** — a `scheduled` handler runs on a cron (`0 7 * * SUN`, configured in `wrangler.toml`), refetches and parses the calendar, filters events that start or end in the current Sun–Sat week (with all-day "end date is exclusive" semantics handled explicitly), formats each as `"- {title}: {friendly date/time in America/New_York}"`, and POSTs a JSON payload to a Slack incoming webhook URL from `env.SLACK_WEBHOOK_URL` (`src/index.js`, `handleScheduled`).
- **Manual Slack-trigger test hook** — `?test-slack=true` on the HTTP endpoint runs `handleScheduled` synchronously and returns success/failure as plain text, letting an operator test the Slack integration without waiting for the cron (`src/index.js`, `fetch` handler).

## Integrations
- **FIRST Inspires calendar page** (HTML scrape target, not an API) — `https://www.firstinspires.org/programs/calendar?view=list&program=frc`.
- **Google Calendar** — indirectly, by parsing the "Add to Google Calendar" deep-link the FIRST site itself generates, and by producing a feed URL meant to be subscribed to from Google/Apple/Outlook calendar apps.
- **Slack** — via a single incoming webhook URL (`SLACK_WEBHOOK_URL` secret), no bot/OAuth app.
- **Cloudflare Workers/Wrangler** platform — Cache API, Cron Triggers, `HTMLRewriter`; deployed via GitHub Actions (`.github/workflows/deploy.yml`) which runs `wrangler dev` for a smoke test then `wrangler deploy` on push to `main`.

## Notable Implementation Details
- Entire app is one file (`src/index.js`, ~370 lines) — no framework, no build step beyond `wrangler`; trivial to re-implement as a scheduled function/cron job in any serverless runtime.
- Deliberately derives event dates from the site's *own* "Add to Google Calendar" link rather than parsing displayed date text — a robustness trick worth stealing: if a source site already emits a structured calendar-add link, parse that instead of freeform date strings.
- The "ends with opens/closes" title-string heuristic is fragile (locale/wording-dependent) but a pragmatic example of turning a single deadline instant into a visible calendar block.
- No tests beyond a CI smoke check that `wrangler dev` boots and answers `?bypass=true`; `scratch/test.js` exists in the tree but wasn't inspected in depth (not load-bearing to feature survey). No retry/backoff on the upstream fetch; a single `502`/error response is returned to the client or swallowed (logged) in the scheduled path.
- No license file despite being a public repo — treat as ideas-only per project ground rules.

## Verdict
Thin but genuinely useful for its narrow niche: a very small, single-file reference for "scrape FIRST's official calendar → ICS feed → weekly Slack digest" using Cloudflare Workers primitives (HTMLRewriter, Cache API, Cron Triggers). Worth stealing: parsing the site's own "Add to Google Calendar" link as the authoritative date source instead of scraping displayed text, and the cache-with-bypass-param pattern for a scraper-backed public feed. Not a broader team-ops platform — no auth, no persistent data, single integration point (Slack webhook).

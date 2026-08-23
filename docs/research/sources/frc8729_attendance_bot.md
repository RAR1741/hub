# FRC8729_attendance_bot — Source Survey

**Repo:** Spark-Youth-Robotics-Club-8729/FRC8729_attendance_bot — https://github.com/Spark-Youth-Robotics-Club-8729/FRC8729_attendance_bot
**Surveyed-at:** 9613afc71458750808c5f4f8401e08006b5bd66f
**Permalink form:** https://github.com/Spark-Youth-Robotics-Club-8729/FRC8729_attendance_bot/blob/9613afc71458750808c5f4f8401e08006b5bd66f/<path>
**Stack:** Python, discord.py (slash commands), sqlite3, Google Sheets API (`google-api-python-client`)
**License:** MIT (LICENSE file present at repo root)
**Last activity:** 2025-02-02 (`pushed_at` 2025-02-02T01:02:51Z)
**FRC team:** 8729 (Sparkling H2O) — per README, built by team members Lucas J. and Dylan C.
**Areas:** time/attendance (primary); people/rosters (role-tagged member records); third-party integrations (Google Sheets); communication (Discord slash commands + approval workflow)

## Purpose
A single-file Discord bot that lets FRC members clock in/out of meetings via slash commands, routes clock-out requests through a lead-approval button UI, and mirrors accumulated hours to both a local SQLite database and a per-member Google Sheets calendar tab, explicitly designed to be forked by other teams (README calls out the fork/config steps).

## Auth & Roles
Discord server role-based, not a formal permission system:
- On first clock-in, the bot inspects the invoking member's Discord roles (`software`, `business & outreach`, `mechanical`) to tag them into a subteam (`SOFTWARE`/`B&O`/`MECHANICAL`/`IDK` fallback) — `main.py:222-251`.
- `/forceclockout` checks for a `management` Discord role before running (`main.py:369-371`); every other command (`/list`, `/clockin`, `/clockout`, `/leave`) is open to anyone in the guild.
- Clock-out isn't self-service: it posts an Approve/Deny button (`MyView`, `main.py:70-89`) into an admin-only channel (`CHAN` env var) and blocks on the lead's click before committing hours — the closest thing to a review gate in this codebase.
- No web login, no per-user database auth — identity is entirely "whoever is issuing the slash command in Discord," keyed by `interaction.user.display_name` (a **display name**, not a stable Discord user ID — a name change or duplicate display name would fork/merge records incorrectly).

## Data Model
Single SQLite table `team` (`List.db`, schema at `main.py:135-137`):
- `Name` (string, = Discord display name, used as the de facto primary key in every query)
- `Total` (int seconds accumulated)
- `ClockIn` (int unix timestamp of current session start)
- `App` (string `'TRUE'`/`'FALSE'` — currently-clocked-in flag)
- `Request` (int unix timestamp of a pending clock-out request)
- `Role` (string subteam tag: SOFTWARE / B&O / MECHANICAL / IDK)
- `Paused` (boolean, defined but never referenced elsewhere in `main.py` — dead column)

No foreign keys, no meeting/session table — each row is a running per-person total, not a log of individual attendance events, so there's no historical per-meeting record, only a lifetime hour counter plus whatever ends up mirrored to the spreadsheet's daily calendar cells.

## Features
**Time/attendance**
- `/clockin` — starts a session; auto-inserts a new roster row (subteam-tagged from Discord roles) if the user has never clocked in before (`main.py:185-255`).
- `/clockout` — computes elapsed time since `ClockIn`, posts an approve/deny request card to the admin channel, and only commits `Total += elapsed` once a lead clicks Approve; on deny, just flips the user back to clocked-out with no hours added (`main.py:258-346`).
- `/leave` — self-service escape hatch to flip `App` back to `'FALSE'` with no approval and no hours recorded, for accidental clock-ins (`main.py:349-358`).
- `/forceclockout` (management-role only) — bulk-processes every currently-clocked-in member, sending one approve/deny card per person sequentially and updating each on decision; used as an end-of-night sweep (`main.py:362-441`).
- Nightly auto-reset task (`send_hello_loop`, `main.py:41-66`) — a `asyncio` background loop that wakes at 1 AM local time, force-zeroes `App` and `Total` for the whole `team` table, and announces it in the admin channel. (Note: this looks like a scheduled full data wipe rather than a "clock everyone out for the day" op — worth double-checking against team intent before reusing verbatim.)
- `/list <team>` — paginated (25-per-embed) roster + hours + clocked-in-status report, filtered by subteam integer code (`main.py:141-182`).

**Third-party integration (Google Sheets sync)**
- `spreadsheet.py::createNewCalendar` — on approved clock-out, looks up whether the member already has a per-person sheet tab; if not, provisions one via `batchUpdate` `addSheet`, seeds a day-by-month calendar grid (rows 1–31, columns Jan–Dec, SUM formulas for monthly/yearly totals), and adds a hyperlink back-reference row on the master "Overall Timesheet Summary" sheet.
- `addToCalendar` — writes today's incremental hours into that member's per-day/per-month cell, accumulating on top of any existing value read back from the sheet first (read-modify-write, not overwrite).
- Auth via a downloaded Google service-account JSON key file (hardcoded filename in source, `spreadsheet.py:14`) + `SPREADSHEETID` env var.

## Integrations
- **Discord** (`discord.py`, slash commands via `app_commands`, guild-scoped command sync) — bot token, guild ID, and admin-channel ID from `.env` (`TOKEN`, `ID`, `CHAN`).
- **Google Sheets API** (`googleapiclient` + `google-auth`) — service-account credential file + `SPREADSHEETID` env var; no OAuth user-consent flow, purely server-to-server.
- No SMS/email, no TBA, no other integrations.

## Notable Implementation Details
- **SQL built via f-strings, not parameterized queries** throughout `main.py` (e.g. `main.py:95`, `:156`, `:198`, `:276`, `:293`) — since values are Discord display names (user-controlled, arbitrary Unicode), this is a live SQL-injection surface in a straight port; any re-implementation should switch to parameterized queries.
- **Identity keyed by mutable display name**, not Discord user ID — renaming in Discord silently creates a duplicate/orphaned roster row rather than continuing the same person's record.
- The repo's actual working tree is dominated by a committed Python virtualenv (`myenv/`, thousands of files) — that's the entire reason for the ~17MB repo size; the real source is two files (`main.py`, `spreadsheet.py`) plus `README.md`/`LICENSE`/`requirements.txt`/`List.db`. A re-implementer gets essentially nothing from the bulk of the repo; treat `.gitignore`-ing venvs as a lesson here, not a pattern to copy.
- Approval flow blocks synchronously per-user inside `/forceclockout`'s loop (`await view.wait()` inside a `for` loop, `main.py:409`) — for N clocked-in members it sends N sequential approval cards one at a time rather than batching, so a large roster makes the lead click through many prompts serially.
- The nightly reset job computes "seconds until 1 AM" once, sleeps, does the reset, then hardcodes an additional flat `asyncio.sleep(86400)` (`main.py:66`) rather than recomputing the next 1 AM — a subtle drift bug if the process is ever paused/resumed near the boundary, and worth replacing with a proper recompute-each-iteration loop or a cron-style scheduler in a rebuild.
- Spreadsheet writes are all synchronous Google API calls made directly inside Discord interaction handlers — no queue/retry/backoff, so a slow or failing Sheets API call stalls the bot's event loop and the interaction response.

## Verdict
Substantive and directly on-topic despite the tiny real source footprint (~450 + ~200 lines): a clean, MIT-licensed, minimal working example of the "Discord clock-in/out with lead-approval + Google Sheets mirror" pattern common across FRC teams — worth stealing the approval-button UX (`MyView`) and the auto-provisioned per-person Sheets calendar-tab idea, but its SQL-injection-prone queries, display-name-as-identity keying, and reset-loop drift bug should all be fixed rather than ported as-is.

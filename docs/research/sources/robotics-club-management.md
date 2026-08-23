# Robotics Club Management — Source Survey

**Repo:** wejdan-h/robotics-club-management — https://github.com/wejdan-h/robotics-club-management
**Surveyed-at:** a8084d182ded61130dc677bd666a7ee4ee170c04
**Permalink form:** https://github.com/wejdan-h/robotics-club-management/blob/a8084d182ded61130dc677bd666a7ee4ee170c04/<path>
**Stack:** PHP (mysqli, procedural), MySQL, vanilla JS (Fetch API), HTML/CSS. Hosted on InfinityFree shared hosting.
**License:** none (no LICENSE file) — ideas only, all rights reserved by default.
**Last activity:** 2026-07-16 (pushed_at)
**FRC team:** unknown — this is "Smart Robotics Club" at Jazan University (a student club site), not an FRC team; no team number anywhere in the repo.
**Areas:** (2) people/rosters only, and only in the thinnest possible sense (a single flat member list).

## Purpose
A learning-project demo: a one-page dashboard that lets a visitor add a "member" (name + age) to a MySQL table and toggle each member's Active/Inactive status via AJAX without a page reload. It is explicitly a PHP/MySQL/Fetch-API practice exercise (see README "Learning Outcomes"), not a real club-operations tool.

## Auth & Roles
None. `index.php` has no login, no session, no access control — anyone who loads the page can add members and toggle any member's status. There is exactly one implicit "role" (anonymous public visitor = admin).

## Data Model
One table, `members`, inferred from `db.php`/`index.php`:
- `id` (PK, auto)
- `name`
- `age`
- `status` (0/1, boolean Active/Inactive)

No relationships, no other tables, no timestamps, no roster metadata (grade, subteam, contact info, attendance, etc.).

## Features
- **People/rosters**
  - Add a member via a plain HTML form (`index.php`) posting `name`/`age` to `db.php`, which does a raw `INSERT` (escaped via `mysqli_real_escape_string`) — `db.php`
  - Render all members in a table, newest first (`ORDER BY id DESC`) — `index.php`
  - Toggle a member's Active/Inactive status in place via `fetch()` POST to `toggle.php`, then optimistically flip the displayed text client-side without re-fetching — `script.js`, `toggle.php`
  - Static "About the club" / "What We Explore" marketing sections (Robotics, Arduino, AI, IoT) with no dynamic backing — `index.php`

That is the entire feature set. No search/filter, no edit/delete, no pagination, no export, no email/notifications, no auth, no other areas (no attendance, integrations, communication, parts ordering, or manufacturing tracking) are present at all.

## Integrations
None.

## Notable Implementation Details
- **Hardcoded production DB credentials committed to the repo** in `db.php` (host, username, password, database name in plaintext) — a concrete anti-pattern to avoid, not a pattern to reuse.
- `toggle.php` builds its `UPDATE` with the raw `$_POST["id"]` string-interpolated directly into SQL with no escaping/parameterization — a SQL-injection hole (contrast with `db.php`'s insert path, which does escape inputs).
- The "real-time" update in `script.js` is purely optimistic UI (string-toggles the table cell text on fetch success) rather than reading the server's actual returned/new status — if the toggle fails, the UI can silently desync from the DB.
- No prepared statements anywhere (uses the older `mysqli_query`/`mysqli_real_escape_string` API throughout).

## Verdict
Too thin to be a substantive source: it's a single-table, no-auth, credentials-leaking student practice app with three trivial features (add/list/toggle) and none of the other five in-scope areas. Nothing here is worth recreating; noted only as an anti-pattern reference (don't commit DB creds, don't skip parameterized queries, don't rely on optimistic-UI-only sync).

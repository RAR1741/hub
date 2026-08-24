# Team 8 Attendance Web — Source Survey

**Repo:** team8/attendance-web — https://github.com/team8/attendance-web
**Surveyed-at:** a2fc0a5fb159ec65f04193791821def8ff7616a6
**Permalink form:** https://github.com/team8/attendance-web/blob/a2fc0a5fb159ec65f04193791821def8ff7616a6/<path>
**Stack:** Node.js/Express 4 + EJS server-rendered views, Firebase Realtime Database (client SDK used server-side), bcryptjs, Chart.js, jQuery/Bootstrap 4 + DataTables on the front end, deployed to Google App Engine (`app.yaml`, `runtime: nodejs12`)
**License:** none (all rights reserved) — no LICENSE file, `package.json` marks it `"private": true` — ideas only
**Last activity:** 2019-12-13 (repo `pushed_at`; the single inspected commit is dated 2019-12-13T01:02:01Z — this looks like an early prototype that was never iterated on)
**FRC team:** Team 8 (org name `team8`; Firebase project literally named `team8-attendance`)
**Areas:** time/attendance (primary); people/rosters (minor, as a byproduct of attendance)

## Purpose
A minimal web attendance tracker: members sign in/out with a token/PIN, hours accumulate in Firebase, and a mentor-facing table/detail view shows totals and per-day logs. It reads as a first-semester learning project (Express generator scaffold, hardcoded date strings, one commit) rather than a maintained tool.

## Auth & Roles
- No session/cookie auth at all — `cookie-parser` is wired into `app.js` but never used to set or read a session.
- "Login" is a raw POST to `/signin` (`routes/index.js`) that calls `fb.authenticateUser(userId, password)` (`api/firebase.js`), which does a bcrypt compare against the Firebase-stored hash and returns either the full user record or a plain-string error message — no token/session is issued back to the client, so nothing enforces the login afterward.
- No role model: every route (`/`, `/user/:user`, `/deleteUser`, `/signup`) is unauthenticated and world-readable/writable. Anyone who can reach the server can list all users' hours, view/edit any individual's logs client-side, or delete a user record.
- Passwords are hashed with bcryptjs at signup (`hashPassword` in `api/firebase.js`), which is the one solid practice in the codebase.

## Data Model
Firebase Realtime Database (no schema enforcement, pure JSON tree), read via the client SDK loaded server-side:
- `users/{userId}` → `{first, last, email, subteam, password}` — the roster/profile record, keyed by an arbitrary user-supplied `userId` token (not a real auth UID).
- `year/2019/off-season/{userId}/logs/{date}` → `{hours, timein, timeout}` — attendance/time-log entries, plus a `total-hours` rollup read alongside `logs`.
- `getUsers()`/`getUser()` in `api/firebase.js` manually join the `users/` and `year/.../off-season/` trees by key and stitch `total-hours` onto the user object before rendering.
- The season path is hardcoded (`year/2019/off-season/...` and even a literal `10-17-2019` date in `logTime`) — there is no season/year abstraction; a new year requires editing source.

## Features
**Time/attendance:**
- Log-hours endpoint: `POST /logHours` (`routes/index.js`) → `fb.logTime(id, hours, timein, timeout)` writes a dated entry under a user's `logs` node (`api/firebase.js`). Note the date is hardcoded to `10-17-2019` in `logTime` — the endpoint doesn't actually use "today's" date, a real bug/limitation worth noting if drawing on this design.
- Roster/attendance dashboard: `GET /` renders `views/users.ejs` — a DataTables-powered sortable/searchable table of every user (token, email, name, subteam, total hours) with per-row "View" and "Delete" actions.
- Per-user detail page: `GET /user/:user` renders `views/user.ejs` with two tabs — a raw table of every dated log (date/hours/time-in/time-out, with time-in/out cells marked `contenteditable` in the DOM though nothing wires that back to the server) and a Chart.js line chart of hours over time built from the same log data embedded in a `<meta>` tag.
- Delete-user action: `POST /deleteUser` (`routes/index.js` → `fb.deleteUser`) removes a user's Firebase record entirely, wired to a "Delete" button in the roster table via `fetch()` (`views/users.ejs`).

**People/rosters (secondary):**
- Signup endpoint `POST /signup` creates a new roster entry (`fb.createUser`) with first/last/email/subteam/password, rejecting if the `userId` token already exists.

## Integrations
- Firebase Realtime Database — the entire persistence layer (`api/firebase.js`), with an API key and project config committed in plaintext in the repo.
- Google App Engine deploy target (`app.yaml`).
- Chart.js and jQuery DataTables/Bootstrap loaded from public CDNs in the EJS views — no bundler/build step.
- `reload` npm package wraps the Express app for live-reload during dev (`app.js`).

## Notable Implementation Details
- Firebase config (API key, database URL, project ID) is hardcoded directly in `api/firebase.js` and committed — a clear anti-pattern (should be env vars/secrets), though Firebase web API keys are not meant to be secret by design; still, worth flagging since a re-implementation should use server-side service-account credentials instead of the client SDK.
- Uses the client-side Firebase SDK from a Node server, which is unusual — a real re-implementation should use the Firebase Admin SDK (or a proper DB) server-side instead.
- `node_modules/` is committed to the repo, which explains most of the ~18.8MB size; genuine hand-written source is under 10 files.
- No input validation anywhere: `/signup`, `/logHours`, `/deleteUser` all trust raw request bodies with no schema/type checks.
- No tests, no CI config, no error handling beyond the generated Express 404/500 boilerplate.
- Season/year is a hardcoded path segment (`year/2019/off-season`) rather than a modeled concept — a rotation to a new season requires a code change, not a config change.

## Verdict
Thin: a single-commit, unauthenticated Express+Firebase prototype (roster table, per-user hour log, hardcoded-date log endpoint) with no real auth/session enforcement and hardcoded credentials/season data. Worth stealing only the shape of the idea — a simple roster table + per-user hours-over-time chart (Chart.js) view — nothing in the auth, data-modeling, or security approach should be reused.

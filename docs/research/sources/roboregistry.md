# RoboRegistry — Source Survey

**Repo:** https://github.com/bubner/RoboRegistry
**Surveyed at commit:** `943e1ee420d3868ec49f2ef6a71e1612ed628ea1`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/bubner/RoboRegistry/blob/943e1ee420d3868ec49f2ef6a71e1612ed628ea1/<path>`

## Purpose

**Not an internal team-ops tool** — flagging this clearly, since it does not fit the six-area
survey rubric (attendance/people/purchasing/communication/integrations/design-manufacturing for
*one's own team*). RoboRegistry is a **multi-team event registrar for FIRST scrimmages/off-season
events**, spanning FLL, FTC, and FRC (`README.md`). Any FIRST team, mentor, or independent
organizer can create an "event" (a scrimmage, workshop, demo day, etc.), and *other* teams
register for it, providing headcounts and a point of contact; on the day, attendees check in via
QR code or manual entry. The event owner then exports attendance/headcount statistics for grant
reporting. It is closer in spirit to an Eventbrite/RSVP system for the FIRST community than to a
team's internal roster or attendance tracker — there is no concept of "my team's members," only
"people/teams attending my event." Live instance: https://roboregistry.app.bubner.me.

## Stack

- **Language:** Python 3. `src/vercel.json` configures a Python serverless function build.
- **Framework:** Flask 3.1 (`src/app.py`), organized as four Blueprints — `auth` (`src/auth.py`),
  `api` (`src/api.py`), `events` (`src/events.py`), and a template-filter blueprint `filters`
  (`src/utils.py`).
- **Database/auth backend:** Firebase — Realtime Database (via the `firebase-rest-api` PyPI
  package, aliased as `fb.db` in `src/fb.py`) for all app data, and Firebase Auth (`fb.auth`) for
  identity, including Google OAuth. No SQL database; no ORM. `src/fb.py` holds the Firebase config
  (API key from env) and initializes `auth`/`db` handles used throughout `db.py`/`auth.py`.
  Firestore/Cloud Storage libs are listed in `src/requirements.txt` but the code only exercises the
  Realtime DB and Auth REST surface.
- **Frontend:** Server-rendered Jinja templates (`.html.jinja`) with Bootstrap 5 (CDN), Tabulator
  5.5.1 (data-grid rendering + CSV/XLSX export), SheetJS `xlsx.full.min.js`, DOMPurify, Chart.js,
  Luxon and humanize-duration for client-side time math, and `html5-qrcode` for browser-based QR
  scanning. Custom JS under `src/static/*.js` (no bundler/framework — plain script tags).
- **Security middleware:** `flask-talisman` enforces a strict CSP (`src/app.py`) with an explicit
  allowlist of CDN origins and nonced inline scripts; `Flask-WTF`'s `CSRFProtect` covers all forms.
- **License:** GNU GPL-3.0, Copyright (c) 2023 Lucas Bubner — full text in `LICENSE`. Copyleft:
  any redistributed derivative must also be GPL-3 and source-available. The Cheesy-Parts-derived
  team-hub project should treat this as reference-only (re-implement ideas, never copy code).
- **Deployment/hosting:** Vercel serverless (`src/vercel.json`), env vars for `SECRET_KEY`,
  `FIREBASE_API_KEY`, `OAUTH_TOKEN` (Google OAuth client secret), `MAPBOX_API_KEY`. No Docker, no
  CI config beyond a CodeFactor badge in the README (no `.github/workflows` content of note beyond
  what `find` reported as an empty/near-empty directory).

## Auth & Roles

- **Identity:** Firebase Auth via `fb.auth`, wrapped by a Flask-Login `UserMixin` subclass `User`
  (`src/auth.py`) keyed on Firebase's refresh token (`self.id = refresh_token`); `load_user`
  (`src/app.py`) re-derives a fresh ID token and account info on every session load. No local
  password store — Firebase owns credentials entirely.
- **Sign-in methods:** email/password (`POST /login`, `POST /register` — `src/auth.py`) and Google
  OAuth (`GET /googleauth` → `fb.auth.authenticate_login_with_google()`, callback at
  `GET /api/oauth2callback` in `src/api.py`, always "remember me"). Password reset via
  `/forgotpassword` sends a Firebase reset email; password *change* (`/changepassword`) also just
  triggers a Firebase reset email rather than an in-app change form. Registration enforces a
  password policy (8+ chars, one digit, one uppercase) and blocks duplicate emails
  (`src/auth.py`).
- **Profile completion gate:** `wrappers.validate_user` (`src/wrappers.py`) — applied as a
  decorator on most routes — forces any authenticated user with no `users/<uid>` record to
  `/create_profile` first, and any user whose Firebase email is unverified to `/verify`, before
  they can reach the page they wanted (round-tripped via `session["next"]`).
- **Roles are self-declared, not access-control roles.** `create_profile`/`settings`
  (`src/auth.py`, `src/app.py`) let a user pick `role` ∈ `student | mentor | event_organiser |
  other`, but this is a display/profile attribute only — it gates no route or feature. The real
  authorization boundary is **event ownership**: `wrappers.must_be_event_owner` checks
  `creator == utils.get_uid()` (via `db.get_uid_for`) and 403s otherwise (`src/wrappers.py`).
  There is no admin/superuser role anywhere in the app; every user is symmetric, differentiated
  only by which events they created vs. registered for.
- **Account deletion:** self-service, double-confirmed with a random 6-digit code the user must
  re-type (`GET/POST /deleteaccount`, `src/auth.py`), cascades to delete all owned events
  (`db.delete_all_user_events`) and the user's own profile record (`db.delete_user_data`).

## Data Model

All data lives in Firebase Realtime Database as a JSON tree (no schema file; shape inferred from
`src/db.py`, `src/events.py`, `src/api.py`):

- **`users/<uid>`** — `first_name`, `last_name`, `email`, `role` (student/mentor/event_organiser/
  other), `affil` (affiliation/team), `promotion` (marketing-consent bool). Keyed by Firebase
  `localId`. (`db.get_user_data`/`mutate_user_data`, `src/db.py`)
- **`events/<event_id>`** — one node per event, `event_id` derived from a slugified name + date
  (`src/events.py::create`). Fields: `name`, `creator` (owner uid), `date`, `start_time`,
  `end_time`, `timezone` (IANA name), `location`, `description`, `email` (public contact or
  `"N/A"`), `limit` (registration cap, `-1` = unlimited), `checkin_code` (random 4-digit PIN),
  `settings: {created, last_modified, visible, regis, checkin}` (three independent booleans:
  public visibility, registration open, check-in open), and `registered/<uid>` — a per-registrant
  sub-tree of **public** data: `entity` (display string `"ContactFirstName | REPNAME"`),
  `registered_time`, `role`, `checkin_data: {checked_in, time}`.
- **`registered_data/<event_id>/<uid>`** — the **private** counterpart, visible only to the event
  owner (Firebase security rules, not shown in this repo, presumably enforce this server-side):
  `repName`, `teams` (JSON-stringified team-number→name map for team registrations), `numPeople`
  (bucketed range string), `numStudents`/`numMentors`/`numAdults` (0-999), `contactName`,
  `contactEmail`, `contactPhone`. Also holds `anon_data` — a pushed list of walk-in check-ins with
  no registration (`rep`/affiliation, `name`, `time`), used for anonymous/on-the-day attendees
  (`db.anon_check_in`).
- **Registration is keyed by Firebase uid** for normal sign-ups (`db.add_entry`, override=False),
  but **manual/owner-entered registrations are pushed with a generated key** (override=True) so an
  event owner can add unlimited manual registrations that aren't tied to any RoboRegistry account
  (`src/db.py::add_entry`, `src/events.py::event_register` manual branch, `src/api.py::
  api_manual_regis`).
- No relational integrity beyond a `creator` string compared against the live Firebase uid at
  request time — there are no foreign-key-style constraints; deletion order is handled manually
  (`db.delete_event` removes `registered_data` before `events`, "otherwise Firebase cannot
  determine an owner").

## Features

- **Firebase-backed registration/login with Google OAuth** — email/password and "Sign in with
  Google," both funnelled through Flask-Login. `src/auth.py`, `src/api.py`
  (`GET /api/oauth2callback`), `src/fb.py`.
- **Guided profile completion** — first-time users must supply name, role, affiliation before
  using the app; enforced app-wide by a decorator, not just on one page. `src/auth.py::
  create_profile`, `src/wrappers.py::validate_user`.
- **Email verification gate** — unverified accounts are redirected to a resend/verify page for
  every gated route until Firebase marks the email verified. `src/auth.py::verify`.
- **Dashboard with rotating subtitle and dynamic action cards** — `/dashboard` renders a static
  shell; `GET /api/dashboard` (`src/api.py`) returns JSON suggestions (upcoming owned/registered
  events in the next 4 weeks, or generic onboarding links if none) that the client renders as
  clickable cards. `src/app.py::dashboard`, `src/api.py::api_dashboard`.
- **Settings page** — edit name/role/affiliation/marketing-consent, plus a dark-mode preference
  stored as a plain cookie (not tied to the Firebase profile). `src/app.py::settings`.
- **"Export all my data" (self-service GDPR-style export)** — one POST endpoint dumps the current
  user's profile, owned events, and registrations as JSON, filtered to strip internal fields
  (`id`, `token`, `passwordHash`). `src/app.py::exportall`, `src/utils.py::filter_kv`.
- **Event creation wizard** — name, date/start/end time, timezone (full IANA list via `pytz`),
  location, description, optional public contact email, attendee cap, with extensive server-side
  validation (name length/sanitization, start<end, event not in the past, duplicate-name+date
  detection generating the event's URL slug). `src/events.py::create`,
  `templates/event/create.html.jinja`.
- **Event view page** — public-facing page for an event showing description, location (Mapbox map
  — see Integrations), countdown/elapsed timers, registered-team count, and register/unregister
  actions gated by ownership, timing, and event settings. `src/events.py::viewevent`,
  `templates/event/event.html.jinja`.
- **"My events" list** — three buckets: events you created, events you're registered for
  (upcoming), and past events you were registered for. `src/events.py::viewall`,
  `templates/dash/view.html.jinja`.
- **Registration form with role-specific fields** — registrants choose a role
  (team/event_manager/mentor/visitor/other); team registrants must additionally supply a headcount
  bucket, student/mentor/adult counts, and one or more FRC/FTC/FLL **team numbers**, each resolved
  live against the author's companion **FIRSTTeamAPI** service to show the team's name
  (`static/eman.js`/`internal_api.js`, `src/events.py::event_register`,
  `src/utils.py::validate_form`). Duplicate representing-names per event are rejected
  (`db.verify_unique`).
- **Unregister** — self-service, blocked once the event has started or the owner has closed
  registration; owners cannot unregister from (or register for) their own event.
  `src/events.py::event_unregister`, `src/db.py::unregister`.
- **QR-code check-in flow, two modes:**
  - *Dynamic/self check-in* — scanning the event QR (or entering the 4-digit `checkin_code`) opens
    a page where the attendee (or an anonymous walk-in providing a name + visit reason) picks
    their registration entity from a list and checks themself in.
    `src/events.py::checkin`/`dynamic`, `templates/event/checkin.html.jinja`,
    `templates/event/gatekeep.html.jinja`.
  - *Manual/registered-email check-in* — a logged-in user who registered for the event can check
    themself in from their own account without the code, as long as they're not the owner.
    `src/events.py::manual`.
  - Anonymous check-ins are recorded separately from named registrants
    (`db.anon_check_in`/`dyn_check_in`) and rolled into "other checkins" metrics.
- **QR-code image generation** — server renders branded PNG QR codes (small plain, or large with
  event name/date/location/contact baked in via Pillow text-fitting) for registration and check-in
  links, sized for print or screen. `src/events.py::gen`, `src/img.py::generate_qrcode`
  (includes word-wrap/font-scaling helpers `_wrap_text`/`_fit_text`/`_draw_fitted_text`).
- **Printable check-in sheet generator** — produces one or more A4-sized PNG pages (zipped if
  multiple) listing every registrant with a checkbox, name, affiliation, plus blank ruled rows for
  walk-ins, sorted by registration time — a paper fallback to QR check-in.
  `src/events.py::gen_ci`, `src/img.py::generate_man_ci`.
- **QR redirect landing page** — a generic `/events/ci` scanner-landing route that validates the
  scanned URL's host before redirecting, to avoid open-redirect abuse from malformed QR payloads.
  `src/events.py::ci`, `templates/event/qr.html.jinja`.
- **Event management console** (owner-only) — metrics (registration count, team vs. other,
  approximate total attendee range reconciling declared headcounts with bucket estimates,
  check-in counts), quick links to generate QR codes / print check-in sheets, toggles for event
  **visibility**, **registration open/closed**, and **check-in open/closed** (three independent
  switches), a "danger zone" delete-event action, and modal-based data views for registrations and
  check-ins with **CSV and Excel (.xlsx) export** via Tabulator + SheetJS.
  `src/events.py::manage`, `src/api.py` (`api_change_visibility`/`api_change_registration`/
  `api_change_checkin`), `templates/event/manage.html.jinja`, `static/eman.js`.
- **Manual registration by the event owner** — a form identical to self-registration but
  server-side flagged `manual=true`, bypassing the "already registered"/"registration closed"
  checks; pushed (not keyed) so multiple manual entries are allowed.
  `src/api.py::api_manual_regis`, `src/events.py::event_register` (override branch).
- **"Open check-in now" override** — lets an owner force an event's start time to the current
  moment (with same-day and other guard checks) to open check-in early without editing the full
  event. `src/api.py::api_open_checkin`.
- **Dedicated check-in "driver" / kiosk mode** — a device-lockdown page that logs the current user
  out (to avoid leaving an account signed in on a shared check-in station) and embeds the
  check-in flow in an iframe alongside the venue's own QR/branding, i.e., turning a tablet into a
  check-in booth. `src/events.py::driver`, `templates/event/driver.html.jinja`.
- **Per-event data API for the management dashboard** — merges public (`events/.../registered`)
  and private (`registered_data`) trees into one payload per registrant, including anonymous
  check-ins, consumed client-side by the Tabulator grids. `src/api.py::api_event_data`.
- **Account deletion** — confirmation via re-typed random code, cascades to delete all owned
  events and profile data, with specific handling of Firebase's "reauthenticate" error.
  `src/auth.py::deleteaccount`.
- **Dark mode** — cookie-persisted (not account-persisted) theme preference, set from Settings.
  `src/app.py::settings`.
- **Static informational pages** — About, Privacy Policy, custom error pages (400/403/404/405/500)
  with a consistent themed template. `src/app.py` (`about`, `privacy`, `error_handler`).

Not present: no team roster/attendance-history for one's *own* team, no purchasing/ordering, no
part tracking, no Slack/Discord bots, no CAD or manufacturing workflow, no multi-admin roles (only
the single "creator" per event).

## Integrations

- **Firebase (Auth + Realtime Database)** — the entire backend; see Stack/Data Model.
  `src/fb.py`, `src/db.py`, `src/auth.py`.
- **Google OAuth 2.0** — "Sign in with Google," configured via a Google Cloud OAuth client
  (`oauth_config` in `src/fb.py`), env `OAUTH_TOKEN` for the client secret; redirect URIs differ
  for local dev vs. the `roboregistry.vercel.app` prod callback.
- **FIRSTTeamAPI** (author's own companion service, https://github.com/bubner/FIRSTTeamAPI,
  hosted at `firstteam.api.bubner.me`) — resolves a bare FRC/FTC/FLL team number to a team name
  during registration, avoiding manual data entry. `static/internal_api.js`
  (`https://firstteam.api.bubner.me/get_team/${number}`), whitelisted in the CSP `connect-src`
  (`src/app.py`).
- **Mapbox GL JS** — renders an interactive map of the event location on the public event page;
  API key from env, script/style pulled from Mapbox's CDN under CSP allowances.
  `src/events.py::viewevent` (passes `mapbox_api_key`), `static/mapbox_marker.js`, `src/app.py` CSP.
- **Tabulator + SheetJS (client-side CSV/XLSX export)** — all "Download as CSV/Excel" buttons in
  the management console run entirely client-side against data already fetched via
  `/api/data/<event_id>`; no server-side export/report code exists.
  `templates/event/manage.html.jinja`, `static/eman.js`.
- **html5-qrcode** — in-browser camera QR scanning, used somewhere in the check-in flow (present
  in `static/libs/html5-qrcode.min.js`; likely referenced from a check-in-adjacent template/script
  not directly opened in this pass).
- **Scribe how-to guide** — the dashboard's default "need help registering" card links to an
  external Scribe walkthrough rather than in-app help. `src/api.py::api_dashboard`.
- **Vercel** — serverless hosting target; `src/vercel.json` (build config, not inspected further).

## Notable Implementation Details

- **No formal roles — ownership is the only permission boundary.** The `role` field on a user
  profile (student/mentor/event_organiser/other) is purely descriptive; every authorization check
  in the codebase (`must_be_event_owner`, `api_*` toggle routes) instead compares the live Firebase
  uid against an event's `creator` string. A re-implementer wanting real RBAC would need to add it
  from scratch — there is no template for permission tiers here.
  `src/wrappers.py`, `src/db.py`.
- **Public vs. private data split across two Firebase trees.** `events/.../registered` (public,
  readable by anyone who can see the event) holds only a derived display string
  (`"ContactFirstName | REPNAME"`) and check-in status; the actual PII (full contact name, email,
  phone, headcounts) lives in a separate `registered_data` tree gated to the event owner
  (`db.get_event_data` — "May only be accessed by the event owner"). This two-tree split is the
  core privacy mechanism, enforced by (unseen) Firebase security rules plus a `KeyError`/`TypeError`
  fallback in the Python layer — there is no independent server-side ACL check duplicating it.
- **Manual (owner-entered) registrations use `push()` instead of keyed `set()`** specifically to
  allow multiple manual entries without a real user uid to key on, at the cost of those entries
  never appearing in a "my registered events" list for anyone. `src/db.py::add_entry` (the
  `override` branch), `src/events.py::manual` docstring ("cannot be traced back to a specific
  user").
- **Timezone handling is manual and repeated** in nearly every event-touching route: each computes
  `pytz.timezone(event["timezone"])`, localizes `strptime` results, and separately recomputes a
  UTC offset for client-side JS countdown timers (`offset = tz.utcoffset(...).total_seconds() /
  3600`). This logic is duplicated across `viewevent`, `manage`, `api_is_auto_open`,
  `api_open_checkin`, `event_must_be_running` rather than centralized in one helper.
  `src/events.py`, `src/api.py`, `src/wrappers.py`.
- **Approximate-attendee math is a min/max reconciliation of two different signals.** `manage()`
  combines the bucketed `numPeople` range ("1-5", "5-10", …) registrants self-report with the
  actual declared `numStudents+numMentors+numAdults` counts to produce a `"lower-upper"` display
  range — an explicit acknowledgment that the two numbers can disagree.
  `src/events.py::manage`.
- **CSP is unusually strict and fully enumerated**, allowlisting exact CDN URLs/versions (Mapbox
  v2.3.1, Bootstrap 5.3.0-alpha3, Tabulator 5.5.1) rather than wildcarding hosts, plus a
  nonce-based `script-src` via `flask_talisman`. Any future CDN dependency bump requires touching
  this list. `src/app.py`.
- **`Talisman`'s custom Jinja autoescape override** — `App.select_jinja_autoescape` re-adds
  `.jinja`-suffixed templates to the autoescape allowlist because Flask's default detector only
  keys off `.html`/`.htm`/etc., and this project's templates are named `*.html.jinja`; without the
  override, autoescaping would silently not apply to any template in this app.
  `src/app.py::App.select_jinja_autoescape`.
- **No server-rendered data export** — CSV/XLSX downloads are 100% client-side (Tabulator +
  SheetJS operating on JSON already fetched by the browser), meaning there's no reusable
  server-side report/export module and no `Content-Disposition` streaming endpoint to model.
  `static/eman.js`, `templates/event/manage.html.jinja`.
- **Event IDs double as URL slugs and Firebase keys**, generated as `<slugified-name>-<date>`
  with a same-name+date collision check, but with no uniqueness re-check under concurrent
  creation (no transaction) — a TOCTOU race is possible if two users submit the same name+date
  simultaneously. `src/events.py::create`.
- **`checkin_code` is a 4-digit PIN (1000–9999)**, i.e., only 9000 possible values with no rate
  limiting visible in this code — brute-forcing a running event's check-in code is not
  meaningfully mitigated at this layer. `src/events.py::create`, `checkin`.

## Activity

Latest commit at the surveyed pin dates `2026-08-05` (per `git log -1`), and commit history/README
reference an actively deployed instance (`roboregistry.app.bubner.me`) plus a CodeFactor quality
badge — indicating this is a live, maintained solo project by its author (Lucas Bubner) rather than
an abandoned one-off, though it is a single-maintainer effort with no visible contributor base.

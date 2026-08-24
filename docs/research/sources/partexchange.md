# FRC Parts Exchange — Source Survey

**Repo:** frc3184/partexchange (canonical: FRC3184/partexchange) — https://github.com/FRC3184/partexchange
**Surveyed-at:** d69df3117e5f20753ca3a5b9af802955e996a600
**Permalink form:** https://github.com/FRC3184/partexchange/blob/d69df3117e5f20753ca3a5b9af802955e996a600/<path>
**Stack:** PHP (procedural, no framework), MySQL/MariaDB (PDO), Bootstrap 3 + jQuery + bootstrapValidator, PHPMailer, Google reCAPTCHA v2
**License:** none (no LICENSE file; `license: null` via GitHub API) — all rights reserved, ideas only
**Last activity:** 2018-02-05 (pushed_at); repo otherwise dormant since ~2017-2018
**FRC team:** Team 3184 (Blaze Robotics), hosted historically at parts.blazerobotics.org
**Areas:** (5) parts ordering/POs — specifically inter-team surplus parts exchange, adjacent to but distinct from internal PO tracking

## Purpose
A "craigslist for FRC teams" — lets any team post a request for a part (raw stock, an obsolete/hard-to-source component, etc.) that another team can offer to fulfill, tracks whether requests were filled, and helps requesters find nearby/regional teams likely to have what they need.

## Auth & Roles
- Session-based auth (`$_SESSION['logged']`, `$_SESSION['teamID']`, `$_SESSION['level']`), no third-party OAuth.
- One "account" per FRC team number, not per person — `account/create.php` + `lib/do_create.php`.
- Passwords: `sha256(salt + sha256(password))`, salt is `random_bytes(32)` stored per-team in `teams.salt`. Verification in `lib/verify.php`.
- Role model is a single integer `teams.level` (0 = normal team, 1 = moderator/verifier, 2 = admin). Checked ad hoc in each script (`$_SESSION['level'] >= 1` etc.) — no central authorization layer.
- Password reset via emailed one-time token in `pass_reset` table with a 15-minute expiration (`lib/resetPassword.php`, `account/reset_password.php`).
- reCAPTCHA v2 gates account creation (`account/create.php`) and part posting (`parts/request.php`, verified server-side in `lib/do_create.php` / `lib/postPart.php` via `lib/recaptchalib.php`).

## Data Model
(from `frc-part-db.sql`)
- **teams**: `teamId` (PK, = FRC team number), `teamName`, `email`, `password`, `salt`, `website`, `twitter`, `has_profile_pic`, `level`, `zipcode`, `region`, `gets_emails` (digest opt-in), plus `lat`/`lng` (added at signup via TBA/Google geocoding, used for distance search).
- **requests** (the part listings): `idrequests` PK, `request_teamID`, `request_date`, `description` (short title), `long_description`, `site_url` (link to a part's webpage), `image_ext` (uploaded photo), `supply_team_id` (set when fulfilled), `fulfilled_date`, `return_date` (present in schema — for loaned parts, unused by any surveyed code), `verified` (defaults to 1; auto-flips to 0 after 3 spam flags via a MySQL trigger).
- **flags**: `(idrequests, teamId)` unique pair — one flag per team per request; `check_num_flags` trigger unverifies a request at 3 flags.
- **pass_reset**: `token`, `teamId`, `expiration` — single-use, time-boxed password reset tokens.

## Features
Parts marketplace (area 5 — parts ordering/POs, surplus-exchange variant):
- **Post a part request** — title, long description, optional external link, optional image upload (validated extension/MIME, size-limited by `post_max_size`) — `parts/request.php`, `lib/postPart.php`.
- **Browse/search open requests** — paginated table, filter by keyword (`like`), by requesting team number, by region/district, and (if logged in) by distance in miles via a `calc_distance(team, team)` SQL function — `parts/index.php`.
- **View single request** — `parts/part.php`; shows requester, fulfiller (if any), description, optional image/link.
- **Mark a request as filled** — requester or a moderator enters the fulfilling team's number in a modal; sets `supply_team_id` + `fulfilled_date` — `parts/part.php` (UI) + `lib/markForm.php` (handler), with an ownership/level check.
- **Delete a listing** — owner or level>=1 moderator only — `lib/deletePart.php`.
- **Flag as spam/inappropriate** — any logged-in team, one flag each, auto-unverifies after 3 flags via DB trigger — `parts/flagPart.php`, schema trigger in `frc-part-db.sql`.
- **Moderator verify** — level>=1 users can re-verify a flagged/unverified listing — `parts/verifyPart.php`.
- **Regional/district scoping** — every team is tagged with a region (district/state/country) via `lib/region.php`, used for filtering and for the digest; region validated server-side against a canonical list.
- **Distance-based search** — "within 10/20/50 miles" filter for logged-in teams, backed by a `calc_distance` SQL function and per-team lat/lng.
- **Weekly email digest** — CLI-only cron script (`digest.php`) emails each opted-in team a count of parts requested/unfilled in their region with a link to view them.
- **New-listing email fanout** — on posting a request, emails every opted-in team in the same region immediately (`lib/postPart.php`).
- **Team profile pages** — public team page with lazy-loaded contact info (`account/team.php` + `account/contact.php`), profile picture upload (`account/update.php`).
- **Site stats page** — public aggregate counts (total requests, % filled, # registered teams); full team roster/contact table visible only to level>=2 admins — `stats.php`.
- **Account settings** — update email/twitter/website, email-digest opt-out, profile picture, and password (old-password check required) — `account/update.php`.

## Integrations
- **The Blue Alliance API** — on account creation, looks up the team's lat/lng (and nickname) by team number (`lib/do_create.php`, `https://www.thebluealliance.com/api/v3/team/frc{id}`).
- **Google Maps Geocoding API** — fallback geocode from city/state/country when TBA has no lat/lng.
- **Google reCAPTCHA v2** — account creation and part posting.
- **SMTP email via PHPMailer** — transactional (password reset, new-part-in-your-region) and a weekly digest cron.

## Notable Implementation Details
- Very small/flat codebase (~4.3MB, mostly vendored CSS/JS/fonts); genuinely thin as *code* but the **feature list is a complete, coherent product** for the exchange use case — worth surveying for ideas even though nothing should be copied.
- Region-based fanout email on every new post could be a spam/scale risk at higher team-density regions; digest is a reasonable alternative pattern worth keeping, immediate-fanout is the part to reconsider.
- Auth/authorization is entirely ad hoc per-script (`$_SESSION['level'] >= N` checks scattered through files) — no central permission function; a re-implementation should centralize this.
- SQL is mostly parameterized (PDO prepared statements) — good baseline — but table/query construction for search filters concatenates raw `$_GET` values into SQL fragments in a few spots (`parts/index.php`'s `$region`/`$team`/`$miles` clauses use bound params correctly, but the pattern of building WHERE clauses by string concatenation is fragile and worth doing more safely in a re-implementation).
- Password hashing (`sha256(salt + sha256(pw))`, salt via `+` string coercion in PHP, which is actually numeric addition, not concatenation) is a legacy/weak scheme — use bcrypt/argon2 in any reimplementation, not this pattern.
- Spam moderation model (crowd-flag threshold auto-unverifies + moderator re-verify) is a lightweight, cheap-to-implement pattern worth reusing conceptually.
- "Distance to other teams" via geocoded team home address, feeding a nearby-teams part search, is the standout idea for cross-team parts sharing.

## Verdict
Substantive and directly relevant despite small code size: a complete small feature set for an inter-team surplus-parts marketplace (post/browse/search/fulfill/moderate + regional & distance search + email digest). Worth stealing the *ideas*: region/distance-scoped browsing, crowd-flag moderation with auto-unverify, weekly opt-in digest email, and TBA-based auto-geocoding of teams at signup. No code reuse (no LICENSE = all rights reserved).

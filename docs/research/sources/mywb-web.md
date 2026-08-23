# Team3256/myWB-web (+ myWB-flutter) — Source Survey

**Repo:** Team3256/myWB-web — https://github.com/Team3256/myWB-web
**Companion repo:** Team3256/myWB-flutter — https://github.com/Team3256/myWB-flutter (same team's
native iOS/Android counterpart, surveyed together here per instructions)
**Surveyed-at:** myWB-web `f2652feaaa111efcf3384495da19ff8ce835a98b` (get via:
`gh api repos/Team3256/myWB-web/commits --jq '.[0].sha'`); myWB-flutter
`18f0964f5edb32f994d08dcb82259f8751e09e27` (get via:
`gh api repos/Team3256/myWB-flutter/commits --jq '.[0].sha'`)
**Permalink form:** https://github.com/Team3256/myWB-web/blob/f2652feaaa111efcf3384495da19ff8ce835a98b/<path>
and https://github.com/Team3256/myWB-flutter/blob/18f0964f5edb32f994d08dcb82259f8751e09e27/<path>
**Stack:** Dart / Flutter (web build in myWB-web via `flutter build web`, native iOS/Android in
myWB-flutter — same app shared across two Flutter targets, not two separate codebases), Firebase
(Auth + Realtime Database used only as a one-time API-key generator), a custom REST backend
(`dbHost`/`authHost`, not in either repo) fronting the real data store, Discord OAuth, Google
Sign-In, `flutter_webview_plugin` + `stripe_stuff.js` for the merch store checkout.
**License:** ambiguous — no LICENSE file in either repo. `myWB-web/lib/utils/config.dart` embeds
an MIT license string (`appLegal`, "Copyright (c) 2020 WarriorBorgs 3256") for display inside the
app's About page, but this is not a repo-root LICENSE file and neither repo declares a license via
GitHub's API (`license: null`). Treat as **ideas only** per ground rules; the MIT text is a strong
signal of intent but not a binding grant absent an actual LICENSE file.
**Last activity:** 2021-03-25 (both repos pushed within a minute of each other; both are archived —
myWB-web's README states it was superseded by `Team3256/myWB`, a newer repo not covered by this
survey)
**FRC team:** FRC Team 3256, the WarriorBorgs
**Areas:** (1) time/attendance — core feature; (2) people/rosters — user profiles, roles, subteams,
grade/varsity tracking; (4) communication — Discord account linking, announcements/blog model.
Also contains a team merchandise store (Stripe-backed) which is out of the six named areas and
noted only for completeness, not surveyed in depth.

## Purpose
A combined team-ops web/mobile app: attendance tracking with GPS-geofenced check-in/check-out at
events, a roster of member profiles (contact info, grade, varsity/JV status, apparel sizing, role
and permission tags), a Discord-account-linking flow gating full app access, and a blog/announcement
feed. The web build additionally serves as the public team website (About/Team/Outreach pages) and
a Printful/Stripe merch storefront.

## Auth & Roles
- **Auth:** Firebase Authentication. Google Sign-In is the only login path exposed in the UI in
  both apps (`myWB-flutter/lib/screens/auth/login_page.dart`,
  `myWB-web/lib/pages/auth/login_page.dart`); an email/password path exists in the Flutter app but
  is hardcoded to a single dev/test account
  (`myWB-flutter/lib/screens/auth/login_page.dart:534-556`, comparing against a literal
  `yeet@vcrobotics.net` / `riplane`) — not a real credential system.
- **Domain gate (web only):** on first Google sign-in, if the user isn't yet in the backend DB, the
  web app only allows registration when the Google account email contains `warriorlife.net` (the
  school district domain) — `myWB-web/lib/pages/auth/login_page.dart:533-541`. Anyone else is
  signed back out with an alert.
- **Discord-linking gate:** after registering, both apps force the user through a Discord OAuth
  handshake (`register_discord_page.dart` in web; not present as a forced step in the Flutter tree
  surveyed) before granting full access — a user record with `discordID`/`discordAuthToken` still
  set to the sentinel string `"404"` is treated as "not yet linked" and redirected back to
  `/register/discord` on every login (`myWB-web/lib/pages/auth/login_page.dart:524-528`).
- **Session/identity plumbing is a notable anti-pattern:** there is no real session token. The web
  app stores only the Firebase UID in browser `localStorage` (`_localStorage["userID"]`) and then
  calls the backend with a **static, hardcoded shared secret** (`"Authentication": "Bearer $apiKey"`)
  for authorization to its own REST API — see Notable Implementation Details below for how that
  "key" is generated.
- **Roles/perms:** `User` has a free-text `role` string and a `perms: List<String>` plus
  `subteams: List<String>` (`myWB-flutter/lib/models/user.dart`,
  `myWB-web` equivalent) but no code in either surveyed tree actually branches UI/API behavior on
  `role` or `perms` — they appear to be intended for a backend/admin panel not present in these repos.

## Data Model
No schema files ship in either repo (the backend is external), but the client models imply:
- **User** — `id` (Firebase UID), `firstName`, `lastName`, `email`, `phone`, `grade` (int),
  `role`, `varsity` (bool), `shirtSize`, `jacketSize`, `discordID`, `discordAuthToken`, `perms[]`,
  `subteams[]` (`lib/models/user.dart` in both repos).
- **Event** — `id`, `date`, `startTime`, `endTime`, `type` (`"practice"` / `"outreach"` / other),
  `name`, `desc`, `latitude`/`longitude`/`radius` (geofence for attendance) —
  `myWB-flutter/lib/models/event.dart`.
- **Attendance record** (no dedicated model class; built/consumed as raw JSON against
  `/events/{id}/attendance` and `/users/{id}/attendance`) — `userID`, `checkIn`, `checkOut`,
  `status`, computed `hours`.
- **Excused absence** (raw JSON against `/users/{id}/attendance/excused`) — `eventID`, `status`
  (`"unverified"` / `"verified"`), `reason`.
- **Post** — `id`, `title`, `authorID`, `date`, `body`, `tags[]` — `lib/models/post.dart`, backs
  the announcements/blog feed (UI for it is a stub — see Features).
- **Cart** (web only) — `productID`, `userID`, `productName`, `size`, `variant`, `quantity`,
  `price` — `myWB-web/lib/models/cart.dart`, backs the merch store.
- Scouting-only models present in myWB-flutter (`match.dart`, `auto_line.dart`, `climb.dart`,
  `power_cell.dart`, `spin.dart`, `regional.dart`, `team.dart`, `curr_match.dart`) are explicitly
  out of scope per ground rules (scouting app) and were not surveyed further.

## Features

### Time / attendance
- **Geofenced check-in / check-out** — on the event details page, the user's live GPS location
  (via the `location` plugin) is Haversine-distance-checked against the event's stored
  `latitude`/`longitude`/`radius`; check-in is only accepted inside the geofence, and check-out
  independently re-checks the geofence before closing the attendance record and computing hours
  worked (`myWB-flutter/lib/screens/home/event_details_page.dart:860-1116`, functions `checkIn`,
  `checkOut`, `calcDistance`).
- **Auto check-in/out via deep link** — `autoCheckIn` / `autoCheckOut` globals are honored in
  `initState` (`event_details_page.dart:1289-1300`), suggesting a QR-code or push-notification
  driven check-in flow elsewhere in the (unsurveyed) app shell.
- **Excused absence requests** — a member who missed a mandatory practice can submit a free-text
  reason via `POST /users/{id}/attendance/excused` with `status: "unverified"`
  (`event_details_page.dart:919-986`); a separate (unseen) admin surface presumably flips it to
  `"verified"`, which then recolors the event as excused rather than absent throughout the UI.
- **Attendance dashboard** — a circular progress chart (`flutter_circular_chart`) showing percent
  of required practice hours completed vs. attended, computed client-side by summing event
  durations minus verified-excused hours (`myWB-flutter/lib/screens/home/attendance_page.dart`).
  Toggles to a parallel outreach-hours view against a flat 50-hour target.
- **Events list with per-event status coloring** — red (missed, unexcused), green (excused or
  attended), grey (upcoming), team-color (currently checked in) — computed per event by
  cross-referencing attendance + excused-absence endpoints
  (`myWB-flutter/lib/screens/home/events_page.dart`, three near-identical `get*Events` methods for
  All/Practice/Outreach filters).

### People / rosters
- **Self-service registration form** — first/last name, email, phone, grade, varsity/JV toggle,
  shirt size, jacket size dropdowns, pre-filled from the Google account where available
  (`myWB-web/lib/pages/auth/register_page.dart`).
- **Role/subteam/permission fields** on the `User` model, present in both apps as data but with no
  UI to set or enforce them in the surveyed code (backend/admin-only).
- **Dark mode preference** persisted per-device via `shared_preferences`
  (`myWB-flutter/lib/screens/auth/auth_checker.dart:313-339`).
- **Configurable API host** — a hidden settings gear on the mobile login screen lets a user point
  the whole app at a different backend host at runtime, persisted to `shared_preferences`
  (`myWB-flutter/lib/screens/auth/login_page.dart:582-623`) — useful for staging/QA but exposed to
  any end user, not just devs.

### Communication
- **Discord account linking** — after Google registration, the web app redirects to
  `$authHost/auth/discord/login`, receives an OAuth token back via a `?token=` query param, fetches
  the Discord profile (`GET https://discordapp.com/api/users/@me`), and PUTs the resulting
  `discordID`/`discordAuthToken` onto the user's backend record
  (`myWB-web/lib/pages/auth/register_discord_page.dart`).
- **Announcements/blog feed** — `Post` model (title, author, date, body, tags) exists and an
  `AnnouncementsPage` scaffold is wired into both apps' navigation, but the page body itself is an
  unimplemented loading-spinner stub with no fetch call
  (`myWB-flutter/lib/screens/home/announcements_page.dart`) — a designed-but-not-built feature.
- **Discord webhook constant** — `myWB-web/lib/utils/config.dart` hardcodes a Discord webhook URL
  (`prDiscordUrl`) presumably for CI/PR notifications into a team Discord channel; not called from
  anywhere in the surveyed UI code, likely wired into a build script.

### Out of the six areas (noted, not surveyed in depth)
- **Merch store** (`myWB-web/lib/pages/store/store_page.dart`) — a catalog of team apparel
  (polos, hoodies, joggers, stickers) with per-item hover-reveal pricing, a cart model, and
  `stripe_stuff.js` + `flutter_webview_plugin` for checkout. This is team-branded consumer
  merchandise, not FRC parts/PO ordering, so it falls outside area (5) as scoped and is not
  detailed further.
- Scouting screens/models (`lib/screens/scouting/**`, `lib/models/match.dart` etc. in
  myWB-flutter) — excluded per ground rules (scouting app).

## Integrations
- **Firebase** — Authentication (Google Sign-In, email/password) and Realtime Database (used only
  as a disposable key-generator, see below), `firebase_auth`/`firebase`/`google_sign_in` packages.
- **Discord** — OAuth account linking (`auth/discord/login` on an external `authHost`) plus a
  hardcoded outgoing webhook URL for notifications.
- **Google Maps** (`google_maps_flutter`) — renders the event location/geofence on the event
  details page.
- **Stripe** (web only) — `web/stripe_stuff.js` + `flutter_webview_plugin` for merch checkout.
- **Custom backend** — all real data (users, events, attendance, excused absences, posts, cart)
  lives behind a REST API at `dbHost`/`authHost`, which is not part of either repo.

## Notable Implementation Details
- **The "API key" is not a credential, it's a disposable random string.** `cycleApiKey()`
  (`myWB-web/lib/utils/config.dart:2287-2291`) does `apiKey = fb.database().ref("tokens").push().key`
  — it takes Firebase's auto-generated **push ID** (a random, unguessable string, but not a signed
  token, not tied to a user, and never validated against the Realtime DB entry it writes) and uses
  it as a static bearer token on every subsequent REST call to the real backend. Anyone who can read
  network traffic (or the client bundle) gets a value that's functionally a shared static secret
  regenerated once per login. A re-implementation should use real signed tokens (Firebase ID
  tokens, JWTs) verified server-side instead.
- **Sentinel string `"404"` as a "not set" marker** for `discordID`/`discordAuthToken`
  (`register_page.dart`, checked in `login_page.dart:525`) instead of null/optional — brittle if a
  real Discord ID or token ever collided with the literal text `"404"` (won't happen in practice,
  but it's a magic-string code smell worth avoiding in a rebuild).
- **Client-side attendance math with no server reconciliation shown** — required practice hours,
  percent-complete, and excused-hour subtraction are all computed by iterating every event and
  every excused-absence record client-side on each page load
  (`attendance_page.dart`, `events_page.dart`) rather than the backend returning a precomputed
  summary; this is a read-amplification pattern (N events × M excused records × per-event
  attendance lookups, all sequential `await`s) that would not scale past a small team roster
  without also taxing the backend on every screen visit.
- **Geofencing is entirely client-trusted** — the app reads device GPS and self-reports "I was
  within N meters," with no server-side verification of the coordinates it submits
  (`event_details_page.dart` POSTs `checkIn`/`checkOut` with no location payload at all — only the
  client's own gate decides whether to allow the POST). Trivially spoofable by anyone willing to
  fake GPS or hit the API directly; a rebuild should verify location server-side or accept this as
  an honor-system feature only.
- **Two Flutter targets sharing one design, minimal code sharing tooling** — myWB-web and
  myWB-flutter are separately-maintained Flutter apps (not a single codebase with platform
  targets), so features drift independently: myWB-web lacks the geofenced attendance UI entirely
  (its scope is registration + storefront + static team pages), while myWB-flutter lacks the merch
  store. A rebuild targeting both web and mobile should use one Flutter (or web+mobile framework)
  codebase with responsive layouts rather than two divergent apps.

## Verdict
Substantive and directly relevant to two of the six target areas: the geofenced GPS check-in/
check-out attendance system with excused-absence workflow (myWB-flutter's `event_details_page.dart`
and `events_page.dart`) is the most concrete, re-implementable idea here, alongside the
domain-gated registration + forced Discord-linking onboarding flow. The announcements/blog feature
is a wired-but-unbuilt stub, and the merch store is out of scope. Worth stealing: the
check-in/check-out-with-geofence UX pattern and the excused-absence request/verify state machine;
worth avoiding: the disposable-Firebase-push-ID-as-bearer-token auth pattern and fully
client-computed attendance percentages.

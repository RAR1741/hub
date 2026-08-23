# JaguarRobotics/management-system — Source Survey

**Repo:** JaguarRobotics/management-system — https://github.com/JaguarRobotics/management-system
**Surveyed-at:** a105a23654edc217924405d74af07f8376603c8f (get via: gh api repos/JaguarRobotics/management-system/commits --jq '.[0].sha')
**Permalink form:** https://github.com/JaguarRobotics/management-system/blob/a105a23654edc217924405d74af07f8376603c8f/<path>
**Stack:** Java (Spark micro-framework, JDK, custom REST routing) backend + MySQL/MariaDB; TypeScript/Angular-flavored frontend compiled via a custom build (`ts/`, `tsconfig.json`, `angular.ts`); Jekyll-templated static site/pages (`_includes/pages/*.html`, `_sass/`) for the served UI; Gradle build (`build.gradle`, `gradlew`); log4j2 logging.
**License:** none (all rights reserved) — no LICENSE file in the tree; `license: null` per the GitHub API. Ideas only, no code reuse.
**Last activity:** 2017-01-24 (pushed_at); repo created 2016-12-09.
**FRC team:** USD 232 Robotics — Jaguar Robotics (Java package root is `org.usd232.robotics.management`, matching the org name).
**Areas:** people/rosters (primary — user accounts, roles/permissions, profiles, subteams), time/attendance (kiosk sign-in, meeting attendance, excuses, RSVPs), communication (in-app messages + email/SMS notifications).

## Purpose
A self-hosted Java web server that gives an FRC team a single account system for its members:
login/registration, a permission-gated admin/mentor role model, a physical kiosk sign-in station
for meeting attendance, event/meeting scheduling with RSVP, and a notification/messaging layer
(in-app inbox plus email and SMS-via-carrier-gateway) tied to attendance events.

## Auth & Roles
- Username/password auth with per-user salted SHA-512 password hashes (`AuthenticationApis.hashPassword`,
  `src/main/java/org/usd232/robotics/management/server/apis/AuthenticationApis.java`) — random 16-byte
  salt generated with `SecureRandom` at registration.
- Session-based auth (not JWT): `src/main/java/org/usd232/robotics/management/server/session/Session.java`,
  `SessionManager.java`, `SessionTerminationThread.java` (session expiry/cleanup thread), with a
  `StartedSessionResponse` returned from login carrying the session's permission set and user id.
- **Fine-grained permission model**, not fixed roles: the `users.permissions` column is a MySQL
  `SET` of ~20 discrete string permissions (`attendance.view`, `attendance.modify`, `attendance.excuse`,
  `device.add/update/remove`, `event.edit.type/name/datetime`, `event.view/add/remove`, `kiosk.open`,
  `message.send`, `settings.view/edit`, `signin.kiosk/code/auto`, `user.view/verify/unverify`) —
  see `src/main/resources/.../database/migrations/null.sql`. Default grant on account creation is
  just the three `signin.*` permissions (self-service sign-in only).
- Enforcement is declarative via a custom `@RequirePermissions({...})` method annotation
  (`src/main/java/org/usd232/robotics/management/server/session/RequirePermissions.java`) applied to
  API handler methods and checked by the request router before invocation — e.g. `KioskApis.signIn`
  requires `kiosk.open`, `MessagingApis.send` requires `message.send`.
  Permissions are also modeled as a typed nested object graph client-side
  (`apis/permissions/Permissions.java` composing `KioskPermissions`, `EventPermissions` w/ nested
  `EventEditPermissions`, `AttendancePermissions`, `UserPermissions`, `DevicePermissions`,
  `SettingsPermissions`, `SignInPermissions`, `MessagePermissions`).
- Admin **impersonation**: `POST /impersonate` (`AuthenticationApis.impersonate`, requires
  `attendance.view` + `user.view`) lets a privileged user assume another user's login response
  without their password — useful for mentor support of student accounts, but a real
  privilege-escalation/audit-trail risk if reproduced (no logging of who impersonated whom is
  visible in this code).
- Forgot-username/forgot-password flow issues a random 64-char `resettoken` with a **1-hour
  expiry window** enforced in SQL (`resettokenset` + `DATE_ADD(...,INTERVAL 1 HOUR)`,
  migration `1.7.sql`, consumed in `AuthenticationApis.resetPassword`).
- Account `verified`/`unverified` state (`user.verify`/`user.unverify` permissions) — likely a
  mentor-approval gate before a new registrant can use the system fully.

## Data Model
Six core MySQL tables (schema spread across `null.sql` + `1.0`–`1.7.sql` migrations,
`src/main/resources/org/usd232/robotics/management/server/database/migrations/`):
- **`users`** — id, username, salted/hashed password, name, `pin` (numeric kiosk PIN, unique with
  username), `picture` (later migrated from string path to FK int → `pictures` table), `verified`
  flag, `permissions` SET, `subteam` (added 1.1), `resettoken`/`resettokenset` (added 1.7).
- **`contacts`** — per-user email/phone entries (`type` enum email/phone), phone `carrier` (for
  carrier-gateway SMS), and a `notifications` SET controlling which event types
  (`meeting.missed`, `meeting.reminders`, `team`, `signin.manual`, `signin.auto`) that contact
  point should receive.
- **`events`** — `type` enum(`event`,`meeting`), name, location, date, start/end time, `signup`
  (RSVP-by date) — meetings and one-off events share a table, distinguished by type.
- **`attendance`** — composite PK (`userid`,`eventid`); `signin` datetime, `rsvp` date, `excused`
  boolean — tracks both advance RSVP and actual kiosk sign-in/lateness in one row.
- **`messages`** — recipient/sender/reason/tracking + text content: an in-app inbox row per
  notification, decoupled from the email/SMS delivery layer.
- **`devices`** — hostname, `role` enum(`server`,`AP`), version — tracks kiosk/access-point
  hardware devices registered to the network (`device.add/update/remove` permissions).
- **`pictures`** (added 1.0) — id, mime, `longblob` data: profile pictures stored in-DB rather than
  on disk/S3.
- **`settings`** key/value table, used for schema version tracking (`database.version`) and
  general app settings (`settings.view`/`settings.edit` permissions).
- A hand-rolled sequential SQL migration runner (`DatabaseMigrator.java`,
  `database/migrations/DatabaseMigrator.java`) applies numbered `.sql` files and bumps
  `settings.database.version` — a precedent worth noting even though this codebase predates
  Supabase-style migration tooling.

## Features

### People / rosters (primary area)
- Registration flow collecting name, two email addresses, phone + carrier, username/password
  (`RegisterRequest`, `AuthenticationApis.createAccount`, `_includes/pages/register-content.html`,
  `ts/pages/register.ts`).
- User directory / listing UI (`_includes/pages/users.html`, `_sass/pages/users.scss`,
  `ts/pages/users.ts`, backed by `UserApis.java`) — presumably the admin roster view.
- Per-user profile page with editable contact methods and notification preferences
  (`_includes/pages/profile.html`, `ts/pages/profile.ts`, `ProfileApis.java`,
  `apis/AddContactRequest.java`/`EditContactRequest.java`/`RemoveContactRequest.java`).
- Subteam grouping (`users.subteam` column, migration `1.1`) used to scope team-wide messages
  to a subteam instead of the whole roster (see `MessagingApis.send`).
- Fine-grained permission/role administration described above (`user.verify`/`user.unverify`,
  `SettingsApis.java` for global settings).
- Forgot username/password self-service recovery (`_includes/pages/forgot.html`,
  `ts/pages/forgot.ts`, `ForgotCredentialsRequest.java`, email delivery via
  `messaging/messages/ForgotPasswordMessage.java` / `ForgotUsernameMessage.java`).

### Time / attendance
- **Kiosk sign-in station**: `GET /kiosk/*` looks up a user by their numeric PIN and returns
  profile + computed lateness/absence counters in one call (`KioskApis.getUser`,
  `_includes/pages/kiosk.html`, `_sass/pages/kiosk.scss`, `ts/pages/kiosk.ts`); `POST
  /kiosk/signIn` finds the currently-in-progress meeting (window logic: within 1 hour before
  start through 1 hour after end, or an all-day event) and upserts an `attendance` row with
  `signin = NOW()` (`KioskApis.signIn`).
- Attendance dashboards/records (`_includes/pages/attendance.html`, `_sass/pages/attendance.scss`,
  `ts/pages/attendance.ts`, `EventApis.java` + `EventAttendance.java`/`EventAttendanceRecord.java`)
  with `attendance.view`/`attendance.modify`/`attendance.excuse` permission gates and a dedicated
  excuse-a-miss endpoint (`ExcuseRequest.java`, `api/attendance/excuse.json`).
- Event/meeting scheduling with RSVP: `EventSignup.java`, `RsvpRequest.java`,
  `api/events/rsvp.json`, add/edit/remove endpoints (`api/events/add.json`, `edit.json`,
  `remove.json`) gated by separate `event.edit.type`/`event.edit.name`/`event.edit.datetime`
  sub-permissions — unusually granular edit-field permissioning for what's otherwise a small app.
- Auto-computed lateness/absence counts server-side per user (unexcused-absence count and
  late-signin count both computed via SQL joins in `KioskApis.getUser`) rather than left to the
  client.

### Communication
- In-app message inbox: `GET /recent` returns a user's messages newest-first, joined against
  `users` to show sender name or "system" for automated messages (`MessagingApis.getMessages`).
- Team/subteam broadcast messaging: `POST /notify` fan-outs a message row to every user (target
  `team`) or to every user sharing the sender's `subteam` (target = subteam), gated by
  `message.send` (`MessagingApis.send`, `NotificationRequest.java`, `NotificationTarget.java`).
- Automated notification triggers layered on top of the message table: meeting-missed and
  meeting-reminder notifications (`notifications/MeetingNotifications.java`), manual/auto sign-in
  notifications (`notifications/SignInNotifications.java`), each independently toggleable per
  contact method via the `contacts.notifications` SET.
- Actual outbound delivery is email + SMS-via-carrier-gateway (contact `carrier` field implies the
  classic "phonenumber@carrier-sms-gateway.com" pattern), driven by a background messaging
  controller/thread (`messaging/MessagingController.java`, `messaging/MessagerThread.java`,
  `messaging/Messages.java` enumerating message templates — register, verified/unverified,
  forgot-password, forgot-username).

### Infrastructure / device tracking (minor, adjacent)
- Device registry for kiosk/AP hardware (`DeviceApis.java`, `Device.java`, `DeviceRole.java`) with
  add/update/remove permissions and a `device.role` of `server` or `AP` — this looks like it also
  managed the physical network infrastructure the kiosks ran on, not just team-member data.
- Raspberry Pi update endpoint (`api/update/raspberrypi.json`) suggesting the kiosk was a
  Pi-based physical terminal that pulled updates from this server.

## Integrations
- Email delivery (SMTP, implied by `messaging/messages/*Message.java` + `MessagingController`) —
  no external provider name visible in the truncated read, but the pattern is self-hosted SMTP or
  a local relay, not a third-party API.
- SMS via phone-carrier email-to-SMS gateways (the `contacts.carrier` column), not Twilio or
  another SMS API — a cheap/free pattern worth remembering for a hobbyist/no-budget team context.
- No OAuth, no Slack/Discord, no Onshape/TBA integration found anywhere in the tree.

## Notable Implementation Details
- Hand-rolled REST framework on top of Spark (`server/routing/*`: `GetApi`/`PostApi` annotations,
  `RouteMapper`, `BaseRoute`, `BinaryResponse`) plus the custom `@RequirePermissions`
  annotation-based authorization checked centrally by the router — a clean declarative-permissions
  pattern worth stealing even though the code itself won't be reused (no license).
- Password hashing is a **single unsalted-round SHA-512** (salt + one digest pass, no
  PBKDF2/bcrypt/scrypt iteration) — a security anti-pattern by 2020s standards; note it as "don't
  copy," not a design to emulate.
- Session storage includes an in-memory `CacheManager`/`CacheEntry`/`CacheData` layer
  (`session/caching/`) alongside `SessionManager`, suggesting request-scoped caching to avoid
  redundant DB hits per session — reasonable pattern for a small self-hosted server.
- Impersonation endpoint has no visible audit logging — a real gotcha for anyone reproducing this
  feature; log the impersonator's identity if rebuilt.
- Schema evolved via 7 sequential hand-numbered `.sql` migration files with a custom runner
  bumping a `settings.database.version` row — a precursor to modern migration tooling, and a good
  illustration of why "replay committed migration files verbatim, never edit in place" (this repo's
  own `AGENTS.md` policy) matters: this project's `1.0`–`1.7` files are exactly that pattern, done
  manually.
- The API is a mix of statically-served mock `.json` fixtures under `api/` (used by the Jekyll/
  static frontend in a "mock" dev mode — see `api/isMock.json`, `server/apis/MockDetection.java`)
  and the real Java Spark backend — a dev-time mock-API pattern that's cheap to reproduce.
- Small overall scale (~379 KB repo, single contributor pattern, last touched January 2017) — a
  complete but modest single-team internal tool, not a maintained open-source project.

## Verdict
Substantive and directly relevant: a real, reasonably complete FRC people/roster + attendance +
communication system with a genuinely good fine-grained permission model, a physical kiosk
sign-in flow, subteam-scoped broadcast messaging, and a notification-preferences-per-contact-method
design. Worth stealing (as ideas, no license to copy from): the granular string-based permission
set with a declarative `@RequirePermissions` enforcement point, PIN-based kiosk sign-in with
server-computed lateness/absence counts, per-contact-method notification toggles, and the
carrier-gateway SMS trick for zero-cost text notifications. Avoid: the single-pass SHA-512 password
hashing and the unaudited impersonation endpoint.

# RoboWebProj — Source Survey

**Repo:** RishabhJain96/RoboWebProj — https://github.com/RishabhJain96/RoboWebProj
**Surveyed-at:** b3e962ff3d325cb68eae490b9bf3fcbdcc328f10
**Permalink form:** https://github.com/RishabhJain96/RoboWebProj/blob/b3e962ff3d325cb68eae490b9bf3fcbdcc328f10/<path>
**Stack:** PHP 5-era procedural/OOP MVC (no framework), raw `mysql_*` extension (pre-PDO/mysqli), custom hand-rolled ORM-lite (`dbUtils`/`dbConnections`), plain HTML/CSS views, PHP `mail()` for notifications. No package manager, no build step, no tests beyond ad-hoc "Tester" scripts.
**License:** none (no LICENSE file in repo) — all rights reserved, ideas only.
**Last activity:** 2012-02-20 (single commit visible via API; repo is a long-dormant historical snapshot)
**FRC team:** Harker Robotics, Team 1072 (per README: "Harker Robotics 1072 Information System")
**Areas:** (2) people/rosters (registration, login, user types, check-in/attendance-adjacent), (5) parts ordering/POs (full purchase-order approval workflow), (4) communication (email notifications on PO status change)

## Purpose

An internal, from-scratch PHP web app for FRC team 1072 (Harker Robotics) combining member
registration/login/check-in with a full purchase-order (PO) system: members submit part orders,
which flow through a two-stage Admin → Mentor approval pipeline with email notifications at each
status change, before being archived as completed purchases. Three parallel copies of the app
exist in the repo (`dev-production`, `other/development`, `other/installable`, plus `production`) —
snapshots of the same codebase at different stages, `dev-production` being the most complete/current
one surveyed here.

## Auth & Roles

- **Auth:** custom session-less username/password login (`controllers/login.php`), password hashed
  with **md5** (no salt) — `login.php::checkLogin()`. Registration (`controllers/register.php`)
  generates an activation code (`md5(mt_rand())`) and a default password constant
  (`register::DEFAULT_PASS = "qwerty"`); `register()` inserts the user then immediately calls
  `activateNewUser()` — activation-by-email-link flow implied but code path collapses it
  automatically in this snapshot.
- **Roles:** a `UserType` string column on `RoboUsers` with at least `Regular` (default),
  `Mentor`, `Admin`, `VP` — see `controllers/roboSISAPI.php::isAdmin()` (`VP`, `Admin`, or `Mentor`
  all count as admin-privileged) and `::isMentor()` (`Mentor` only). `controllers/rootController.php`
  adds a super-admin-style `setAdmin($username)` / `getAdmins()` pair for promoting users and listing
  current admins.
- **Enforcement:** role checks are plain boolean helper methods (`isAdmin`, `isMentor`) called from
  view/controller code before rendering admin vs. mentor vs. regular-user views
  (`views/admin_dashboard.php`, `views/adminvieworder.php`, `views/mentorvieworder.php`,
  `views/mentorviewpending.php`); no centralized middleware/guard — each page is responsible for its
  own check.

## Data Model

Inferred from the controller/query code (no `.sql` schema file in repo, only backups under
`other/DB_BACKUPS/`):

- **RoboUsers** — `UserID`, `Username`, `UserPassword` (md5), `UserPhoneNumber`, `UserEmail`,
  `UserType`, `ActivationCode`.
- **UserHistories** — check-in log: `UserID` (FK), `HistoryTimeStamp` (human-readable),
  `NumericTimeStamp` (sortable `YmdHi` format) — `roboSISAPI::inputCheckIn()` /
  `getCheckIns()` / `hasReachedCheckInLimit()` (capped via `MAX_CHECKINS_PER_DAY` constant).
- **OrdersTable** — one row per PO: `OrderID`, `UserID`/`Username` (submitter, reassignable via
  `financeController::setSubmittingUser()`), `UniqueID` (16-char `uniqid` token), `Status`
  (`Unfinished` → `AdminPending` → `AdminApproved`/`AdminRejected` → `MentorPending` →
  `MentorApproved`/`MentorRejected`), `Locked` (bool, locks the order from editing while under
  review), `PartVendorName`, `ConfirmationOfPurchase`, `AdminApproved`/`AdminComment`/
  `AdminUsername`, English + numeric submitted/approved date pairs.
- **OrdersListTable** — one row per line-item/part within an order: `OrderListID`,
  `UniqueEntryID` (per-part `uniqid` token, lets `updateOrder()` diff new vs. existing lines),
  `OrderID` (FK), part name/vendor/cost fields, per-part `Status`/`AdminApproved` (parts can be
  approved individually via `setPartsAdminApproval()`, independent of the parent order's overall
  status).
- **ArchiveOrders / ArchiveOrdersList** (referenced in `archiveOrder()` doc comment) — completed
  orders are meant to be copied here and removed from the live tables, though the surveyed
  `archiveOrder()` implementation only does the delete half (copy step is a stub/no-op in this
  snapshot — see Notable Implementation Details).

## Features

**People / rosters**
- Self-service registration with duplicate-username check and md5 password hashing —
  `dev-production/controllers/register.php`.
- Login with per-field error messages (bad username vs. bad password) —
  `dev-production/controllers/login.php`.
- Password reset view — `dev-production/views/resetpass.php`.
- User profile view/edit — `dev-production/views/profilepage.php`,
  `dev-production/controllers/profileController.php`.
- Role promotion to Admin, and admin roster listing — `dev-production/controllers/rootController.php`.
- Daily check-in system with a configurable per-day cap (`MAX_CHECKINS_PER_DAY`), timestamped
  history per user — `dev-production/controllers/roboSISAPI.php` (`inputCheckIn`, `getCheckIns`,
  `hasReachedCheckInLimit`).
- Admin dashboard listing users/orders — `dev-production/views/admin_dashboard.php`.

**Parts ordering / POs**
- Order submission form with a dynamic parts list (multi-row line items) —
  `dev-production/views/submitform.php`, backed by
  `dev-production/controllers/financeController.php::inputOrder()`.
- Order editing before lock — `dev-production/views/editform.php`,
  `financeController::updateOrder()` (diffs existing vs. new line items by `UniqueEntryID`).
- Two-stage approval pipeline: submit → lock → Admin approve/reject
  (`financeController::submitForAdminApproval`, `setAdminApproval`, `isAdminApproved`) → Mentor
  approve/reject stage (status strings `MentorPending`/`MentorApproved`/`MentorRejected` handled
  in `notificationsController::refineStatus`).
- Per-part (not just per-order) admin approval — `financeController::setPartsAdminApproval()`.
- Admin queue view of pending orders — `dev-production/views/adminviewpending.php`,
  `financeController::getAdminPendingOrders()`.
- Mentor queue view of orders awaiting mentor sign-off —
  `dev-production/views/mentorviewpending.php`, `dev-production/views/mentorvieworder.php`.
- Single-order detail views for admin and regular users —
  `dev-production/views/adminvieworder.php`, `dev-production/views/vieworder.php`.
- "View all forms" / "view my forms" list pages —
  `dev-production/views/viewallforms.php`, `dev-production/views/viewmyforms.php`.
- Change-order workflow (post-approval amendment) — `dev-production/views/changeorder.php`.
- Full-text keyword search across all orders and their line items —
  `financeController::searchAllOrders()` (linear scan with `stripos`, no DB-side search).
- Printable purchase order and printable Bill of Materials, with a dedicated print stylesheet —
  `dev-production/views/printorder.php`, `dev-production/views/printBillofMaterials.php`,
  `dev-production/views/billOfMaterials.php`, `dev-production/views/stylesheets/print.css`.
- Order archiving on completion — `financeController::archiveOrder()`.
- Reassigning which user is recorded as having submitted/purchased an order —
  `financeController::setSubmittingUser()`.

**Communication**
- Automatic email to the submitter on every status change (locked-for-review, approved, rejected),
  with a human-readable status string and vendor name in the message body —
  `dev-production/controllers/notificationsController.php::emailUserStatusUpdate()`,
  `refineStatus()`. Sent via PHP's built-in `mail()`, `From: harker1072@gmail.com`.
- Automatic email to the mentor when an order first reaches `MentorPending` —
  `notificationsController::notifyMentorOfPending()`, looked up via
  `roboSISAPI::getMentorsEmail()` (first user found with `UserType == "Mentor"`).

## Integrations

None. No third-party APIs (no Onshape/TBA/Slack/Discord/Google/SMS). The only "integration" is
outbound email via PHP's native `mail()` function to `@students.harker.org` addresses derived from
username, and a hardcoded `harker1072@gmail.com` From address.

## Notable Implementation Details

- **Deeply pre-modern PHP**: uses the long-removed `mysql_*` extension (not `mysqli`/PDO) for all
  DB access, wrapped in a thin custom `dbUtils`/`dbConnection` layer
  (`back_end/dbUtils.php`, `back_end/dbConnections.php`) — reimplementing basic ORM operations
  (`selectFromTable`, `insertIntoTable`, `updateTable`, `deleteFromTable`,
  `selectFromTableAsc/Desc`) by hand. A re-implementation should treat this as the ORM's job
  (Eloquent/Prisma/Supabase client) rather than porting the wrapper.
  `dev-production/back_end/dbUtils.php`, `dbConnections.php`.
  - **No SQL injection protection beyond manual escaping**: `roboSISAPI::sanitize()` calls
    `mysql_real_escape_string()` plus `strip_tags`/`trim` on every field going into the DB — the
    2011-era equivalent of parameterized queries, worth replacing with real bound parameters/ORM
    in any re-implementation rather than copying the pattern.
- **Passwords hashed with unsalted md5** (`login.php`, `register.php`) — a hard "don't do this"
  flag; any recreation should use bcrypt/argon2 (or delegate to Supabase Auth) instead.
- **Status is a free-form string state machine**, not an enum/constraint: `Unfinished`,
  `AdminPending`, `AdminApproved`, `MentorPending`, `AdminRejected`, `MentorRejected`,
  `MentorApproved` are matched by string comparison scattered across
  `notificationsController::refineStatus()` and `financeController`. Worth modeling as a real
  enum/state column with an explicit transition table in any re-implementation.
- **Order locking is a plain integer flag**, not a DB-level lock: `Locked` is set to `1` on submit
  for approval and reset to `0` on rejection so the user can edit again — a simple, effective
  pattern worth keeping conceptually (freeze row edits while pending review) even if the
  mechanism (app-level flag vs. RLS/permission gate) should modernize.
- **Per-part approval decoupled from per-order approval** (`setPartsAdminApproval` vs.
  `setAdminApproval`) — a genuinely useful idea: an admin can approve some line items of a PO while
  rejecting/holding others, rather than all-or-nothing at the order level.
- **Search is a linear in-memory scan** (`searchAllOrders()` pulls every order + every line item
  into PHP arrays and does `stripos` matching) — fine at FRC-team scale (dozens of orders/season)
  but would not scale; a re-implementation should use real DB `WHERE ... LIKE`/full-text search.
- **`archiveOrder()` is incomplete**: its own doc comment says it should copy rows to
  `ArchiveOrders`/`ArchiveOrdersList` before deleting from the live tables, but the method body only
  performs the deletes — the copy step was never implemented in this snapshot, meaning "archived"
  orders in this codebase are actually just deleted. A cautionary example, not a pattern to copy.
- **Repo contains three/four parallel copies of the entire app** (`dev-production/`, `production/`,
  `other/development/`, `other/installable/`) with no clear single source of truth, plus a
  `finals_site_code` subtree that is an unrelated personal/course project bundled into the same
  repo — the codebase itself is evidence of ad-hoc, un-versioned deployment practice (manually
  copying folders instead of branching/tagging).
- **Email notification identity is inferred, not stored**: `emailUserStatusUpdate()` builds the
  recipient address as `$username . "@students.harker.org"` rather than reading a stored
  `UserEmail` field — brittle (breaks if a member's username differs from their school email
  local-part) but simple; worth calling out as a shortcut not to repeat when a normalized
  `UserEmail`/`UserPhoneNumber` column already exists on `RoboUsers`.

## Verdict

Substantive and directly relevant: this is a real, working two-stage (Admin → Mentor) PO approval
system with per-part approval, locking, email notifications, printable POs/BOMs, and a companion
member registration/login/check-in system — a solid concrete reference for the parts-ordering and
roster areas despite its 2011-era PHP implementation. Worth stealing: the per-part-independent
approval model, the string-based-but-explicit status pipeline (as a template for a proper enum
state machine), and the "lock while pending, unlock on reject" editing-freeze pattern. Everything
implementation-level (raw `mysql_*`, unsalted md5, hand-rolled ORM, linear-scan search) should be
modernized, not ported, and no code should be copied given the missing LICENSE.

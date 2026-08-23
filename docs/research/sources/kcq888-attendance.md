# kcq888/Attendance — Source Survey

**Repo:** kcq888/Attendance — https://github.com/kcq888/attendance
**Surveyed-at:** dc67ad8d3513a581014a7e650e5532ec749aad43 (get via: gh api repos/kcq888/attendance/commits --jq '.[0].sha')
**Permalink form:** https://github.com/kcq888/attendance/blob/dc67ad8d3513a581014a7e650e5532ec749aad43/<path>
**Stack:** Flutter/Dart (mobile+web+desktop targets), Firebase (Auth, Cloud Firestore), Riverpod (with codegen), go_router
**License:** none (all rights reserved) — no LICENSE file present; ideas only
**Last activity:** 2024-10-24 (single `pushed_at` timestamp observed; no commit history browsed beyond HEAD)
**FRC team:** Tough Techs 151 (per README: "designed for FIRST Robotics Team Tough Techs 151")
**Areas:** time/attendance (primary), people/rosters (member roster is a first-class feature)

## Purpose
A Flutter app for FRC teams to view member attendance history and manage the team roster, paired
with a companion Raspberry Pi + RFID reader that scans member ID cards and writes sign-in/sign-out
events directly into the same Firestore database the app reads (`README.md`). The app itself does
not talk to the RFID hardware — it is a viewer/editor for the roster and a manual sign-in/out UI
for existing members.

## Auth & Roles
- Firebase Authentication via `firebase_ui_auth` + `firebase_ui_oauth_google` (Google sign-in),
  wired through `lib/src/authentication/firebase_auth_repository.dart` (`AuthRepository`,
  Riverpod-provided `authStateChangesProvider`).
- `lib/src/screens/login_screen.dart` renders FirebaseUI's `SignInScreen` with a custom
  header/footer (team logo, localized copy).
- Route guarding is auth-state-only (single role, no RBAC): `lib/src/routes/app_route.dart`'s
  `goRouter` redirect callback sends unauthenticated users to `/signIn` and blocks
  `/attendances`, `/members`, `/account`; authenticated users are bounced off `/signIn` to
  `/attendances`. There is no member-vs-mentor-vs-admin distinction — anyone who can sign in can
  edit the roster and any member's attendance.
- `AuthRepository.signInAnonymously()` exists but is unused in the wired-up login flow.

## Data Model
Firestore, scoped per-"season" (a user-configurable string, see Settings below), under two
collections:
- **Members** (`lib/src/models/member.dart`, `lib/src/repositories/member_repository.dart`,
  path `<season>/members/rfids`, doc ID = RFID tag): `First`, `Last`, `RFIDTag`.
- **Attendance** (`lib/src/models/attendance.dart`,
  `lib/src/repositories/attendance_repository.dart`, path `<season>/meetings/dates`, doc ID =
  `<rfid>_<MMddyyyy>`): `Name`, `RFIDTag`, `Date`, `SignIn` (Timestamp), `SignOut` (Timestamp),
  `HasSignOut` (bool), `SignInCount` (int, defaults to 1), `AttnHistory` (map, read-only in the
  app — presumably written by the RFID-reader companion app for repeat sign-ins in one day).
- Queryable by date or by RFID tag (`QueryType.queryDate` / `QueryType.queryRfid` in
  `attendance_repository.dart`), always `orderBy("Name")`.

## Features
### Time/attendance
- Daily attendance list for a selected date, live-streamed from Firestore
  (`lib/src/screens/attendance_screen.dart`: `AttendanceScreen` + date picker via
  `showDatePicker`, `lib/src/repositories/attendance_datepicker.dart`'s `selectedDateProvider`).
- Per-member attendance detail/history view queried by RFID
  (`lib/src/screens/memberdetails.dart`: `MemberDetailScreen`, using
  `attendanceByRfidStreamProvider`).
- Manual sign-in / sign-out actions from the member detail screen's app-bar icons
  (`memberdetails.dart` `signIn()`/`signOut()`), calling
  `AttendanceRepository.signIn`/`signOut` (`lib/src/repositories/attendance_repository.dart`) —
  these guard against duplicate sign-in (`doesDocExist`) and duplicate sign-out
  (`alreadySignOut`) for the same day's doc, and surface a snackbar either way
  (`showsnackbar` in `memberdetails.dart`).
- Attendance list tiles show sign-in/sign-out timestamps and a running `SignInCount`
  (`attendance_screen.dart`'s `AttendanceListTile`).
- Attendance detail screen for a single record (`lib/src/screens/attendance_detail_screen.dart`,
  routed via `AppRoute.attendanceDetail`, receiving the tapped `Attendance` object through
  go_router's `state.extra`).
- Per-team "season" setting (a free-text string persisted via `shared_preferences`,
  `lib/src/repositories/attendance_settings.dart`'s `SharedPrefStringNotifier`, edited in
  `lib/src/screens/setting_screen.dart`) namespaces both the members and attendance Firestore
  collections — lets one Firestore project hold multiple years/seasons of data side by side.

### People/rosters
- Member list screen (`lib/src/screens/member_screen.dart`: `MemberScreen`), live-streamed via
  `memberStreamProvider` (`lib/src/services/member_service.dart`), ordered by first name.
- Add/edit member forms (`lib/src/screens/edit_member.dart`,
  `lib/src/screens/edit_member_screen_controller.dart`), writing through
  `MemberRepository.addMember` / `updateMember` (`lib/src/repositories/member_repository.dart`).
- Swipe-to-reveal edit/delete actions per row via a custom `SlideMenu` widget
  (`lib/src/common_widgets/slide_memu.dart`), with a delete confirmation `AlertDialog`
  (`member_screen.dart`'s `buildAlertDialog`) before calling
  `MemberRepository.deleteMember`.
- Member detail screen doubling as the attendance-history-by-member view (see above).

### Cross-cutting
- Bottom-nav shell with three tabs (Attendance / Members / Account) via go_router's
  `StatefulShellRoute.indexedStack` and a custom `ScaffoldWithNestedNavigation`
  (`lib/src/routes/scaffold_with_nested_navigation.dart`), each tab keeping its own navigation
  stack (separate `GlobalKey<NavigatorState>` per branch in `app_route.dart`).
- Localization: English + Spanish ARB files (`lib/l10n/app_en.arb`, `lib/l10n/app_es.arb`) driving
  every screen's strings via generated `AppLocalizations`.
- Responsive layout helpers for wider screens (`lib/src/common_widgets/responsive_center.dart`,
  `lib/src/constants/breakpoints.dart`), used on the settings form.
- Riverpod-generator (`@riverpod`/`@Riverpod(keepAlive: true)`) throughout repositories/services
  for DI and stream caching (`attendance_repository.dart`, `member_repository.dart`,
  `attendance_service.dart`, `member_service.dart`, `firebase_auth_repository.dart`).
- Multi-platform Flutter scaffolding present (android/ios/web/macos/windows/linux directories),
  though the product is a single mobile/web app, not multiple distinct apps.

## Integrations
- **Firebase**: Auth (Google sign-in), Cloud Firestore (sole datastore), Firebase config files for
  Android/iOS/macOS/web (`google-services.json`, `GoogleService-Info.plist`,
  `lib/firebase_options.dart`).
- **External RFID hardware** (not in this repo): README states a companion Raspberry Pi + RFID
  reader app writes attendance records into the same Firestore collections this app reads/writes —
  the actual scan-to-Firestore bridge lives in a separate, unlinked codebase.
- No Slack/Discord/email/SMS/TBA/Onshape integration.

## Notable Implementation Details
- **Season-as-namespace pattern**: rather than a dedicated "season" document/collection with
  proper multi-tenancy, the season string is prepended directly to Firestore collection paths
  (`_season + _datesCol`, `_season + _members`) and persisted client-side only in
  `shared_preferences` — simple but fragile (typos silently create a new empty "season", and the
  setting isn't synced across devices/users).
- Attendance doc IDs are deterministic (`<rfid>_<MMddyyyy>`), which is what makes the
  duplicate-sign-in/out guards (`doesDocExist`, `alreadySignOut`) a simple existence/field check
  rather than a query.
- `Attendance.fromMap` reads `SignOut` only when `HasSignOut` is true, else defaults to
  `Timestamp.now()` — a minor footgun if a caller later assumes `signOut` is always meaningful.
- No RBAC: any authenticated user has full read/write on roster and attendance data — acceptable
  for a small mentor-only Google-account allowlist in practice (likely enforced via Firebase
  project/Firestore security rules not present in this repo) but not visible/enforced in-app.
- Test coverage is minimal: `test/authproviders_test.dart` and a Mockito-generated mock file for
  the auth repository; no tests for attendance/member repositories or screens.
- Single-org branding (team 151 name/logo hardcoded into assets and login screen) — README
  explicitly invites other FRC teams to fork and swap logo/name, i.e. it's designed as a
  reusable/forkable template, not a generic multi-tenant SaaS.

## Verdict
Substantive and directly relevant: a real, non-trivial Flutter+Firebase attendance-and-roster app
with clean repository/service/screen layering, working CRUD on both members and attendance, and a
genuinely useful "season" data-partitioning idea — worth reimplementing (not copying, no license)
the season-namespacing concept and the duplicate-sign-in/out doc-ID guard pattern. The
RFID-reader-writes-directly-to-the-DB integration point is a good precedent for a comparable
hardware-bridge design if RAR1741 ever adds badge/RFID scanning.

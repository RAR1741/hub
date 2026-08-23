# vector-8177-attendance-system — Source Survey

**Repo:** https://github.com/Speedstrike/vector-8177-attendance-system (FRC 8177, Vector)
**Surveyed at commit:** `4acbf9a22e059b24993756cefe59b85ae1c890e5`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Speedstrike/vector-8177-attendance-system/blob/4acbf9a22e059b24993756cefe59b85ae1c890e5/<path>`

## Purpose

A small Flutter desktop/mobile app for FRC Team 8177 (Vector) to record meeting attendance: check
a student in when they arrive, check them out when they leave (duration computed automatically),
add new students on the fly, and view a leaderboard-style statistics table of hours/meetings per
student. There is no login, no roster import, and no purchasing/communication/integration
surface — it is purely a check-in kiosk plus a stats view. Last activity 2025-07-19 (single
squashed commit in this shallow clone — cannot see prior history); README and code both look
finished-enough-to-use but minimal, no CI, no releases, no issues visible from the clone.

## Stack

- **Language/framework:** Dart / Flutter (`pubspec.yaml` targets `sdk: ^3.5.4`). Built for desktop:
  the only platform folder present is `windows/` (CMake + a Win32 `runner`), so this is compiled as
  a Windows desktop app, not deployed to phones (no `android/`/`ios/` folders in the clone).
- **Backend:** Firebase — `firebase_core` + `cloud_firestore` (Cloud Firestore as the sole
  datastore, no custom server). `lib/firebase_options.dart` (FlutterFire-generated) wires a single
  named project. No Firebase Auth is used.
- **Key packages:** `intl` (date formatting/parsing), `fl_chart` (declared in `pubspec.yaml` but
  **not referenced anywhere in `lib/`** — dead dependency), `logger` (also not referenced in
  `lib/`).
- **UI:** Single `MaterialApp`, dark theme (`AppTheme` in `lib/constants.dart`), a bundled
  variable-weight NotoSans font (`lib/fonts/`).
- **License:** No `LICENSE`/`COPYING` file in the repo. Every source file's header comment claims
  "MIT License, Copyright (c) 2024 Aaryan Karlapalem," but because no license file exists at the
  repo root, GitHub's license detector will show "no license" and downstream users cannot rely on
  the header alone as clear grant — flagged per survey method: treat as **ambiguous / effectively
  none until a LICENSE file is added**.

## Auth & Roles

None. There is no login screen, no user accounts, and no Firebase Auth/App Check configured — the
app opens straight to the check-in screen and anyone running the binary has full read/write access
to the `students` Firestore collection (`lib/constants.dart`, `Constants.database`). There is no
role distinction between a mentor and a student user of the app itself.

## Data Model

Single Firestore collection, `students` (`lib/constants.dart`):

- **Student document**, keyed by the student's `name` (used directly as the Firestore document
  ID — see Notable Implementation Details) — `lib/student.dart`:
  - `name` (string)
  - `grade` (int, 9–12)
  - `attendance` (map: `"MM-dd-yyyy"` date string → integer minutes for that day)

There is no separate "meeting" or "event" entity, no roster/season grouping, and no history beyond
one integer-minutes value per calendar date per student (a student who checks in/out twice in one
day overwrites, doesn't accumulate — see below).

## Features

- **Home / check-in screen** — Lists all students loaded from Firestore, four per row, as toggle
  buttons; header shows the current date. `lib/screens/home_screen.dart`
  (`_HomeScreenState.build`), `lib/constants.dart`.
- **Check in** — Tapping "Check in" on a student's tile records the current wall-clock time in an
  in-memory `Map<String, DateTime?> checkInTimes` (not persisted until check-out) and the tile
  turns green. `lib/screens/home_screen.dart` (`_toggleCheckInOut`).
- **Check out (duration write)** — Tapping "Check out" computes
  `DateTime.now().difference(checkInTime).inMinutes` and writes it to
  `attendance.<today's MM-dd-yyyy>` on that student's Firestore document, then clears the
  in-memory check-in state and the tile turns red again. `lib/screens/home_screen.dart`
  (`_toggleCheckInOut`).
- **Add student (modal dialog)** — "Add new student" button opens a dialog with a name text field
  (max 20 chars) and a 9th/10th/11th/12th grade segmented-button selector; submitting creates a new
  Firestore document (doc ID = the name) with an empty `attendance` map and returns the new
  `Student` to the caller, which appends it to the in-memory list without a full reload.
  `lib/screens/add_user_screen.dart` (`_AddStudentScreenState.build`), reused from both the home
  screen and the statistics screen.
- **Attendance statistics screen** — A `DataTable` of every student sorted descending by total
  attended hours, columns: name, total hours, meetings attended, median hours, last meeting date.
  Reached via a "View attendance statistics" button in the home screen's app bar; a "Record
  attendance" button returns. `lib/screens/statistics_screen.dart`, `lib/student.dart`
  (`calculateAttendanceStats`).
- **Per-student stats computation** — `Student.calculateAttendanceStats()` sums the `attendance`
  map's values for total minutes-as-"hours" (the map stores raw minutes but the UI labels the
  column "Total hours" without conversion — see Notable Implementation Details), counts entries for
  "meetings attended," computes the median of per-day values, and finds the latest date key as
  "last meeting." `lib/student.dart`.

Not present: no login/roles, no CSV export, no editing/deleting a student, no editing a past
attendance entry, no meeting/event scheduling, no notifications, no mobile build in this clone
(Windows desktop only), no use of the declared `fl_chart` charting library despite being a
dependency.

## Integrations

- **Google Firebase / Cloud Firestore** — sole backend; `lib/firebase_options.dart`,
  `firebase.json`, `.metadata`. No Cloud Functions, no Firebase Auth, no security-rules file
  present in the clone (rules are presumably configured only in the Firebase console, not checked
  into this repo).

No other external integrations (no Slack/Discord, no calendar, no purchasing/parts system).

## Notable Implementation Details

- **Document ID = student name.** Firestore documents are keyed by the raw `name` string
  (`Constants.database.doc(newStudent.name)`), not a generated UID. Two students with the same
  name collide (the second `add` silently overwrites the first), and a name containing `/` would
  break the document path. `lib/screens/add_user_screen.dart`, `lib/screens/home_screen.dart`.
- **Attendance keyed by calendar date, not by session.** `attendance` is `{date: minutes}`; a
  second check-in/out on the same date overwrites rather than adds to that day's total, and there
  is no way to record more than one meeting on the same date. `lib/student.dart`.
- **Checked-in state is client-local and ephemeral.** `checkInTimes` lives only in
  `_HomeScreenState`/in-memory; navigating away, hot-reloading, or closing the app loses any
  in-progress check-in with no persisted "currently checked in" flag in Firestore. Two devices
  running the app would not see each other's in-progress check-ins either.
  `lib/screens/home_screen.dart`.
- **Silent error swallowing.** Both Firestore reads and the student-creation write are wrapped in
  `try { ... } catch (_) {}` with no user-facing error state — a failed write (e.g. offline) fails
  silently and the UI proceeds as if it succeeded. `lib/screens/home_screen.dart`,
  `lib/screens/add_user_screen.dart`.
- **"Hours" is actually minutes.** `_toggleCheckInOut` stores `.inMinutes`, but the statistics
  screen labels the summed value "Total hours" and reports it as a raw integer/average with no
  unit conversion — the displayed numbers are minutes, not hours, unless meetings happen to run
  exactly 60 minutes. `lib/screens/home_screen.dart`, `lib/screens/statistics_screen.dart`.
- **Dead dependencies.** `fl_chart` and `logger` are declared in `pubspec.yaml` but never imported
  in `lib/`; the statistics screen renders a plain `DataTable`, not a chart.
- **No pagination/backend query, all done client-side.** `_loadStudents`/`fetchStudents` fetch the
  entire `students` collection on every screen open and re-sort/re-filter it in Dart; fine at
  team-roster scale (dozens of students), would not scale to a large historical dataset.
- **Windows-desktop-only build artifact in this clone.** Only `windows/` platform scaffolding is
  checked in; no `android/`, `ios/`, `web/`, `linux/`, or `macos/` folders, so as committed this
  only builds as a Windows desktop app despite Flutter's cross-platform reputation.

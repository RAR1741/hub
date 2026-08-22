# Swartdogs/AttendanceTracker — Source Survey

**Repo:** https://github.com/Swartdogs/AttendanceTracker (FRC 525, Swartdogs)
**Surveyed at commit:** `8ec21fcc3428c2686750f72750e94af9300bbdec`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Swartdogs/AttendanceTracker/blob/8ec21fcc3428c2686750f72750e94af9300bbdec/<path>`

## Purpose

A Windows desktop kiosk app (WinForms, .NET Framework) for FRC Team 525 (Swartdogs) that lets
students self-check-in/out by typing a personal ID at a shared shop-floor terminal, with a
mentor-only unlock code gating administrative actions (locking/unlocking the terminal, force
checkout, removing students, editing student records). It writes a running attendance sheet to a
CSV file and keeps a persisted local roster. There is no README in this repo, so the description
above is inferred entirely from the code. Last activity 2022-10-06 (single squashed commit in this
shallow clone; no further commits/tags/releases visible) — reads as a small, complete, unmaintained
utility rather than an actively developed project.

## Stack

- **Language/framework:** C# WinForms targeting .NET Framework 4.5.2
  (`AttendanceTracker.csproj`, `<TargetFrameworkVersion>v4.5.2</TargetFrameworkVersion>`), built
  with classic (non-SDK-style) MSBuild project format, Visual Studio solution
  `AttendanceTracker.sln`.
- **Persistence:** No database — flat local files under
  `%AppData%\Attendance\` (`Settings.cs`, `Settings.SETTINGS_FOLDER_PATH`):
  - `settings.set` — JSON-serialized `Settings` object (mentor code, file paths).
  - `students.stu` — JSON-serialized list of `Student` records (the roster).
  - `attendance.att` — a CSV attendance log.
- **Key libraries:** `Newtonsoft.Json` (Json.NET) for serialization (`packages.config`,
  `Extensions.cs`). No other third-party dependencies.
- **UI:** Three WinForms dialogs (`NewStudentForm`, `EditStudentForm`, `SettingsForm`) plus the
  main `AttendanceForm`, all built with the WinForms designer (`*.Designer.cs`/`*.resx` pairs).
- **License:** GNU GPLv3, full text at `LICENSE` (repo root). No SPDX/license header inside
  individual source files, but the top-level `LICENSE` file is unambiguous — this is a copyleft
  license, distinct from cheesy-parts' BSD-2-Clause and from vector-8177's ambiguous MIT-header/no-
  file situation.

## Auth & Roles

There is no user-account system or login screen — only a single shared numeric "mentor code"
(default `"0000"`, changeable in `SettingsForm`) that acts as a shared admin PIN:

- **Student self-service (no code needed):** typing an existing student's `ID` into the main
  text box and pressing Enter/Submit toggles that student's check-in state.
  `AttendanceForm.cs` (`CheckIn`).
- **Mentor unlock/lock:** typing the mentor code toggles the form between locked (student-only)
  and unlocked (mentor buttons + the "Selected" checkbox column visible) states.
  `AttendanceForm.cs` (`CheckIn`, `UnlockForm`, `LockForm`).
- **Auto-relock:** a 2-minute idle timer (`LOCK_TIME = 120000` ms) automatically re-locks the form
  after unlock, so a mentor who unlocks it and walks away doesn't leave it open all night.
  `AttendanceForm.cs` (`_lockTimer`, `LockTimerElapsed`).
- **New-student gate:** registering a brand-new ID additionally requires re-entering the mentor
  code inside the `NewStudentForm` dialog before the record is created — so self-service check-in
  cannot silently mint new roster entries without a mentor present.
  `NewStudentForm.cs` (`OkButton_Click`).

There is no differentiation beyond "anyone with the code is a mentor" — no per-mentor identity,
no audit trail of which mentor performed which action.

## Data Model

All three files below live in `%AppData%\Attendance\` by default (paths are user-configurable via
`SettingsForm`):

- **`Setting<T>` / `Settings`** (`Setting.cs`, `Settings.cs`) — three tracked settings, each
  wrapping a value plus its last-saved value to support cancel/revert: `MentorCode` (string,
  default `"0000"`), `StudentFile` (path, default `students.stu`), `AttendanceFile` (path, default
  `attendance.att`). Serialized as JSON via `Extensions.EncryptJson`/`DecryptJson`.
- **`Student`** (`Student.cs`) — `FirstName`, `LastName`, `Email`, `ID` (the check-in code, `Update`
  method allows editing all four), plus at-runtime-only `Selected` (bulk-action checkbox,
  `[JsonIgnore]`) and `CheckInTime` (`DateTime?`, `[JsonIgnore]`, null when not checked in) with a
  derived `CheckedIn` boolean. Persisted as a JSON array to `students.stu`
  (`StudentFile.cs`).
- **`AttendanceSheet.Record`** (`AttendanceSheet.cs`) — `FirstName`, `LastName`, `InTime`,
  `OutTime`. Appended to an in-memory list and flushed to `attendance.att` as a header row
  ("First Name,Last Name,In Time,Out Time") plus one CSV line per checkout event — a running log,
  not a per-student cumulative total.

## Features

- **Self-service check-in/out by ID** — Typing a known student's ID and submitting (button or
  Enter key) checks them in if they were out, or checks them out (writing an
  `AttendanceSheet.Record` with in/out timestamps to the CSV) if they were in.
  `AttendanceForm.cs` (`CheckIn`, `SubmitButton_Click`, `IdTextBox_KeyUp`).
- **New-student registration on first unknown ID** — An ID that matches no existing student and
  isn't the mentor code opens `NewStudentForm`, requiring first name, last name, and re-entry of
  the mentor code (email optional); on success the student is added to the in-memory roster,
  immediately checked in, and the roster file is rewritten. `AttendanceForm.cs` (`CheckIn`),
  `NewStudentForm.cs`.
- **Live roster grid** — A `DataGridView` bound to the student list (sorted by first, then last
  name) with columns Selected / First Name / Last Name / Check In Time / Checked In; the
  "Checked In" cell is highlighted orange when true. `AttendanceForm.cs`
  (`ResetStudentDataGridView`, `StudentDataGridView_CellFormatting`).
- **Mentor lock/unlock via shared code** — Re-entering the mentor code (or a "Lock" button once
  unlocked) toggles admin controls and the row-selection checkbox column on/off; auto-relocks after
  2 minutes idle. `AttendanceForm.cs` (`CheckIn`, `UnlockForm`, `LockForm`, `_lockTimer`).
- **Force checkout (mentor-only, bulk)** — After a confirmation prompt, checks out every currently
  checked-in student at once, backdating each `OutTime` to exactly 10 minutes after their
  `CheckInTime` (a fixed synthetic duration rather than "now"), and writes all resulting records to
  the attendance CSV. `AttendanceForm.cs` (`ConfirmForceCheckout`, `ForceCheckout`),
  `Student.cs` (`CheckOut(forced: true)`).
- **Remove students (mentor-only, bulk)** — Checking the "Selected" box on one or more roster rows
  and clicking "Remove," after a confirmation prompt, deletes them from the in-memory roster and
  rewrites `students.stu`. `AttendanceForm.cs` (`RemoveStudents`), bound to
  `Student.Selected`.
- **Edit student (mentor-only, bulk)** — For each selected student, opens `EditStudentForm`
  pre-filled with first name/last name/email/ID; confirming any of them rewrites the roster file
  once at the end. `AttendanceForm.cs` (`EditStudentsButton_Click`), `EditStudentForm.cs`,
  `Student.cs` (`Update`).
- **Settings dialog** — Mentor-only dialog to change the mentor code and the student/attendance
  file paths (with file-picker browse buttons); each changed value is individually confirmed via a
  "X will be set to Y" prompt before being applied, and changing the student file path forces a
  checkout of everyone first (since the roster identity is about to change).
  `SettingsForm.cs`, `AttendanceForm.cs` (`SettingsStripSettings_Click`).
- **First-run bootstrapping** — If the settings/roster/attendance files don't exist at startup,
  each is created in place (with a `MessageBox` notice) rather than failing.
  `AttendanceForm.cs` (`CreateSettings`, `CreateStudentsFile`, `CreateAttendanceFile`).

Not present: no login/per-mentor identity, no reporting/statistics screen (only a raw CSV to open
elsewhere), no email/notification integration despite storing an `Email` field, no network/cloud
sync (fully local single-machine app), no multi-terminal support, no undo beyond the per-field
settings revert.

## Integrations

None. Fully offline, single-machine, file-based. `Email` is captured on each student record but is
never read or used anywhere in the codebase (no SMTP, no mailto, no export that includes it beyond
the roster file itself).

## Notable Implementation Details

- **"Encryption" is plain Base64, not encryption.** `Extensions.Encrypt`/`Decrypt` just call
  `Convert.ToBase64String`/`FromBase64String` — the settings and roster files (including the
  mentor code and student emails) are trivially reversible, not actually protected at rest.
  `Extensions.cs`.
- **Force-checkout backdates by a fixed 10 minutes**, not to "now" — `Student.CheckOut(forced:
  true)` sets `OutTime = CheckInTime.Value.AddMinutes(10)` regardless of how long the student was
  actually present, so a bulk "everyone forgot to check out" cleanup silently records a flat
  10-minute session for each of them rather than their real duration. `Student.cs` (`CheckOut`).
- **Mentor code is a single global shared secret**, not a per-mentor login — anyone who knows the
  4-character code can unlock the terminal and perform every administrative action; there is no
  way to tell which mentor made a given change, and the code lives in plaintext-equivalent (base64)
  storage.
- **Settings changes are staged, not applied immediately.** `Setting<T>` tracks an
  `_initialValue` vs `Value` and exposes `Changed`; `SettingsForm` prompts to confirm each changed
  field individually and calls `Reset()` on cancel — a small but deliberate undo mechanism for a
  form with no explicit "Cancel all" button beyond closing it. `Setting.cs`, `SettingsForm.cs`.
- **In-memory state is authoritative; files are write-through, not re-read.** `_students` and
  `_attendance` are loaded once at startup and mutated/persisted from memory afterward — the app
  never reconciles against concurrent external edits to the `.stu`/`.att` files, so two machines
  pointed at the same file share (if configured via the settings dialog's path override) could
  clobber each other's writes.
- **No packages folder committed** — `packages.config` references `Newtonsoft.Json.13.0.1` via
  NuGet, restored on build rather than vendored; the clone itself has no `packages/` directory.
- **Classic (non-SDK) csproj format** targeting .NET Framework 4.5.2 — building this today requires
  either an old-style MSBuild toolchain (Visual Studio / `msbuild.exe`) rather than the modern
  `dotnet build` CLI, or a migration to SDK-style projects.
- **No test project, no CI configuration, no README** — this is a minimal, purpose-built utility
  with essentially zero surrounding documentation or automation; all behavior had to be inferred
  from the WinForms code and designer files directly.

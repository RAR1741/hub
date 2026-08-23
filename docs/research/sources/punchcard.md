# PunchCard — Source Survey

**Repo:** offbrandd/PunchCard — https://github.com/offbrandd/PunchCard
**Surveyed-at:** 7332b020577cc27eac8fc3deddac0ce2fba40d3a
**Permalink form:** https://github.com/offbrandd/PunchCard/blob/7332b020577cc27eac8fc3deddac0ce2fba40d3a/<path>
**Stack:** Java (Swing desktop GUI), no build tool manifest present (raw `src/*.java`), flat-file CSV storage — no database
**License:** none (no LICENSE file; repo metadata reports `license: null`) — ideas only
**Last activity:** 2022-09-19 (pushed_at; created 2019-07-18)
**FRC team:** unknown (README says "my former high school Robotics team"; no team number given, though sample output data contains what look like real student names)
**Areas:** time/attendance (only)

## Purpose
A single-PC kiosk app for a robotics team's shop room: students scan or type their ID at a shared computer to punch in/out, and the admin runs a one-click job that totals each student's cumulative hours into a CSV report.

## Auth & Roles
None. There is no login — the app assumes physical control of a shared PC is the security boundary. There is an implicit two-role distinction only by *usage pattern*: students interact with the barcode scanner / Sign In / Sign Out / Create Profile screens, while the "administrator" is simply whoever clicks "Output Totals" (`src/MainMenu.java`) to generate the report; there is no code-level permission check separating these actions.

## Data Model
No database — two flat CSVs act as tables, both hand-rolled as fixed-size 2D `String[][]` arrays with a hardcoded capacity (`maxRows`/`maxCols`):
- `output/log.csv` (`src/LogWriter.java`) — a wide grid: row 0 is a header of student IDs (one column per student, capacity 40 columns); each subsequent pair of rows is one calendar date, with the first row of the pair holding that date's sign-in time per ID-column and the second row holding the matching sign-out time. Dates are found by string-scanning column 0.
- `output/totals.csv` (`src/TotalWriter.java`) — one row per student: `id, name, cumulative_hours` (capacity 30 rows, 3 columns). This is effectively the roster + computed-hours table.
- No explicit relationship/foreign key — `id` (a bare integer, evidently the barcode-encoded student ID number) is the join key used by string comparison between the two files.

## Features
**Time/attendance**
- Barcode-driven punch clock: a background polling thread (`Main.java`, the `barcode` `Thread` in `main()`) calls `BarcodeScanner.searchForBarcode()` every 500ms while on the main screen and auto-routes a scanned ID to sign-in, sign-out, or (if unrecognized) profile creation — `Main.automaticPunch()`.
- Manual Sign In / Sign Out screens with typed ID entry as a fallback to scanning (`src/SignIn.java`, `src/SignOut.java`).
- Duplicate/extra-entry handling: if a sign-in already exists for today, prompts "create another entry?" and appends to the next open date-block row instead of overwriting (`SignIn.confirm()`, `LogWriter.addExtraSignIn()`).
- Sign-out safeguards: warns if signing out someone who never signed in that day, and confirms before overwriting an existing sign-out (`SignOut.confirm()`, `requestOverwrite()`).
- Bulk close-out: "Sign Out All Users" button sweeps every registered ID and signs out anyone still open for the day (`SignOut.signAllOut()`).
- Live "currently signed in" roster shown on the main menu, recomputed on every screen transition (`MainMenu.getActive()` / `isSignedIn()`).
- Profile/roster creation: a Create screen registers a new `(id, name)` pair into both CSVs, rejecting duplicate IDs and flagging (with an override prompt) duplicate names (`src/Create.java`).
- Hours-total report generation: "Output Totals" walks the entire log grid per student, sums each day's (sign-out − sign-in) millisecond delta via `SimpleDateFormat`/`Calendar`, converts to decimal hours, and writes/report-dialogs the result to `totals.csv` (`src/Total.java`, `TotalWriter.closingMessage()`).

**People/rosters** (secondary, folded into attendance)
- The `totals.csv` file doubles as the team roster (id/name pairs) since there is no separate roster feature or UI.

## Integrations
None. `BarcodeScanner` is referenced throughout `Main.java` (`BarcodeScanner.searchForBarcode()`) but **its source file is not present in the repo tree** — it's an undeclared external dependency (likely a webcam-based barcode-reading library, given the "Camera not found" UI label in `MainMenu.java`), so the barcode capture mechanism itself can't be inspected from this repo.

## Notable Implementation Details
- Storage is entirely hand-rolled fixed-size arrays with hardcoded capacities (100 rows/40 cols for the log, 30 rows for totals) — the app silently breaks (`ArrayIndexOutOfBounds`, caught and stack-traced but not handled) once a team exceeds ~19 tracked dates (100 rows ÷ 2 rows/day − header) or 39 students, or a roster exceeds 29 people. A re-implementation should replace this with an actual DB table or at minimum an append-only/streaming CSV writer, not a bounded in-memory grid.
- Every mutation (`addSignIn`, `addSignOut`, `addID`, etc.) does a full-file rewrite via `writeToCSV()`: close reader/writer, delete the file, recreate it, dump the whole in-memory array back out. This is simple but not crash-safe (a mid-write crash or power loss can leave a truncated/empty CSV) and not concurrency-safe.
- CSV parsing is done with manual `indexOf(",")`/`substring` splitting rather than a CSV library, so any embedded comma or quoting would corrupt the grid (visible in the sample data using bare `""` for the date column on blank rows instead of true empty cells).
- Dates are the sole "day" boundary — the log format assumes at most one sign-in/out row-pair per date; the model has no concept of multiple concurrent activities or session metadata beyond raw HH:mm:ss strings concatenated with the date string and parsed via `SimpleDateFormat("yyyy-MM-ddHH:mm:ss")`.
- No tests, no build file (pom.xml/build.gradle) checked in — just raw `.java` files under `src/`, so building requires guessing the classpath / manually invoking `javac`.
- Sample checked-in output data (`output/log.csv`, `output/totals.csv`) contains what appear to be real former students' full names next to ID numbers and computed hours — a re-implementer should not carry this sample data forward as-is.

## Verdict
Thin but legitimately on-topic: a real, working barcode-scan kiosk attendance flow (auto sign-in/out via polling scanner thread, duplicate-entry prompts, bulk sign-out-all, hours-total report) worth mining for the *workflow* (kiosk mode, auto-route unrecognized IDs to profile creation, end-of-period hours rollup), but the storage layer (bounded arrays, full-file rewrites, no DB) is an anti-pattern to avoid, not to copy; no license file means implementation must be rewritten from scratch regardless.

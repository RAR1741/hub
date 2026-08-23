# FRC_Attendance-App — Source Survey

**Repo:** ikknight/frc_attendance-app — https://github.com/IKKNIGHT/FRC_Attendance-App
**Surveyed-at:** 1c32a89b40ce231c1055471f7a436f7ec90dd5f5 (get via: gh api repos/IKKNIGHT/FRC_Attendance-App/commits --jq '.[0].sha')
**Permalink form:** https://github.com/IKKNIGHT/FRC_Attendance-App/blob/1c32a89b40ce231c1055471f7a436f7ec90dd5f5/<path>
**Stack:** Python 3.10 / Flask 2.1 + Flask-SQLAlchemy 2.5 (SQLite), OpenCV 4.6, `face_recognition` (dlib-based) for face detection/encoding, Jinja2 templates + Bootstrap 4/jQuery on the front end, `playsound` for audio feedback
**License:** none — no `LICENSE` file in the repo and no license field in GitHub metadata ("license": null). Ideas only, no code reuse.
**Last activity:** 2024-03-10 (pushed_at; single-author, low-commit-count hobby project)
**FRC team:** Ambiguous — repo owner/README reference "Marvels" and the git remote in the README is `MarvelsOfMAS-FTC/FR-Attendance-App`, i.e. this is an **FTC** team's tool ("MAS" = Marvels), not FRC, despite the survey-scope repo name. Labeling accordingly per ground rules: **FTC team project, comparable to FRC tooling.**
**Areas:** (1) time/attendance — primary and only area covered. Touches (2) people/rosters only incidentally (student/coach registration exists solely to support attendance).

## Purpose
A single-team, self-hosted Flask app that marks attendance for students ("team members") and coaches via live webcam face recognition, replacing manual sign-in sheets. It also allows plain login-based student/coach dashboards and CSV export of attendance history for a given lecture/date range.

## Auth & Roles
- Two disjoint account types with separate tables and separate login routes: `Student` and `Coach` (`app.py:60-111`).
- Password storage is **base64 encoding, not hashing** (`b64e`/`b64d` in `app.py:519-523`) — trivially reversible, a clear anti-pattern to avoid re-implementing.
- Session-based auth via Flask `session` dict; two decorators gate routes: `is_student_logged_in` and `is_coach_logged_in` (`app.py:114-133`), redirecting to the relevant login page with a flash message if absent.
- A boolean `is_admin` flag on `Coach` (`models.py:729`) is set at registration via a checkbox but is **not actually enforced anywhere** in the route logic (no `@is_admin_required` check found) — it's stored but unused, so "admin" is effectively decorative in this snapshot.
- An out-of-band `add_admin.py` script (`MarvelsFacialRecognitionAttendanceSystem/add_admin.py`) seeds one admin Coach directly into the DB from the Python console, storing the password in plaintext (never base64-encoded) — inconsistent with the app's own login path, would break login for that seeded row.

## Data Model
SQLite via SQLAlchemy, 4 tables (`models.py`):
- `Student`: id, rollno (unique, auto-incremented in app code, not DB), name, semester (hardcoded `"MAS"`), team, sub_team, email (unique), password, pic_path (path to the face-recognition training photo), registered_on, deleted (`'Y'`/`'N'` soft-delete flag stored as single char).
- `Coach`: f_id, name, team, email (unique), password, is_admin (bool), registered_on.
- `Attendance`: att_id, rollno, team, sub_team, lecture_no (an integer session/session-direction marker, see below), marked_by (coach name string, not FK), name, marked_date, marked_time.
- `Dropdowndata`: d_id, field, field_value — a generic key/value table used to populate `<select>` dropdowns (e.g. `field='team'`, `field='sub-team'`) instead of a proper lookup table per concept.

No foreign keys are declared anywhere (rollno/team/marked_by are all plain strings/ints matched by value at query time) — cheap to write, but no referential integrity; renaming a coach or team breaks joins silently.

## Features

### Time/attendance (core area)
- **Live face-recognition check-in/out** — `mark_face_attendance()` in `app.py:526-695`: on request, walks `static/images/users/` to build known-face encodings (`face_recognition.face_encodings`) from each student's registration photo, opens the webcam via a threaded, bufferless `VideoCapture` wrapper (`video_capture.py`), runs `face_recognition.compare_faces`/`face_distance` per frame to find the best match, and on a match inserts an `Attendance` row (skipping students already marked for that date+team+lecture). Deleted students (`deleted='Y'`) are filtered out of the known-face list before recognition even starts.
- **IN/OUT mode via CLI arg** — `app.py:39-49`: the app is launched with a numeric arg (`python app.py 1` vs `python app.py 2`) that sets a process-wide `intOutFlag`/`mode` used as the `lecture_no` value and to choose which sound (`attBeep.mp3` vs `logout.mp3`, `static/sound/`) plays on a successful match — i.e., two separate running instances represent "clock in" and "clock out" stations rather than one app with a UI toggle.
- **Manual roll-call fallback screens** — `templates/mark_attendance_1.html`, `templates/mark_attendance_2.html` gate entry into the FR flow only if at least one student is registered.
- **Coach attendance ledger with date-range filter** — `view_coach_attendance()` (`app.py:340-371`): filters `Attendance` by `marked_date` between `fromDate`/`toDate` form fields, defaulting to today; lists distinct lecture numbers for context.
- **Student self-service attendance view** — `view_attendance()` (`app.py:150-163`): a student sees only their own `Attendance` rows.
- **CSV export**, separately for coaches (all records for a lecture, `download_attendance_csv`, `app.py:473-489`) and for students (their own records, `download_student_attendance_csv`, `app.py:493-509`) — built by hand-joining strings, not `csv` module.
- **Per-student/team lecture counts on dashboards** — `student()` and `coach()` views (`app.py:136-174`) compute distinct-team lecture counts and aggregate student/coach counts for the landing dashboards.

### People/rosters (incidental, in service of attendance)
- **Student registration with webcam photo capture** — `register_student()` (`app.py:207-257`) auto-assigns the next roll number (`max(rollno)+1`), captures a photo via `capture_image()` (`app.py:267-291`, a blocking OpenCV window: press `c` to snapshot to `temp.jpg`, renamed to `<rollno>-<name>.jpg`), and stores team/sub-team from `Dropdowndata`-driven selects.
- **Soft-delete for students** — `delete_student()` (`app.py:373-384`) sets `deleted='Y'` rather than removing the row, so attendance history survives roster changes; `view_students()` toggles between active/deleted lists via a form flag (`showMode`).
- **Coach registration**, open/unauthenticated in this snapshot (the `@is_coach_logged_in` decorator on `register_coach` is commented out, `app.py:177-179`) — anyone could self-register as a coach, optionally checking an "isAdmin" box.
- **Profile self-edit** for both roles (`coach_profile()`, `student_profile()`, `app.py:410-469`) including photo replacement, which also renames the on-disk face image file to match a new name.

## Integrations
None. No SIS/roster sync, no calendar, no Slack/email/SMS, no cloud services — everything is local SQLite + local filesystem images + local webcam.

## Notable Implementation Details
- **Passwords are base64, not hashed** — an anti-pattern; any re-implementation should hash (bcrypt/argon2) instead of reusing this "encoding as security" approach.
- **Blocking, synchronous face-recognition loop** — `mark_face_attendance()` is itself an infinite `while True` loop with `cv2.imshow`, run inside a single Flask request handler; this only works for a local, single-machine deployment (the coach's laptop) and would never scale to a hosted multi-user app. The face-encoding gallery is also rebuilt from scratch (reading every student photo from disk and re-encoding) on every single visit to the route — no caching/embedding persistence, which does not scale past a small roster.
- **Duplicate-checkin guard is a fresh single-day check** — matches on `rollno + marked_date + team + lecture_no`, so "checked in" state resets daily and per lecture/session; useful low-tech pattern for FRC build-season check-in/out if reproduced correctly (with proper hashing and background workers instead of blocking UI loops).
- **IN vs OUT is a process launch argument, not a UI toggle** — mirrors a two-kiosk (entry/exit) physical setup; a re-implementation would more naturally make this a per-scan-station configuration or a UI mode rather than a CLI arg.
- **No foreign keys / referential integrity** anywhere in the schema; `Dropdowndata` doubles as an ad hoc enum table for both `team` and `sub-team` values.
- Includes committed IDE cruft (`.vs/` Visual Studio folder with `.suo`/`.vsidx`/`slnx.sqlite`), a checked-in SQLite DB file (`db/database.db`), a stray `requirements copy.txt`, and a `backups/` directory of superseded route/template versions — signs of a small unmaintained student/mentor side project, not production software.
- `add_admin.py` seeds a plaintext-password admin that is inconsistent with the app's own base64 login check — would not actually authenticate without manual re-encoding.

## Verdict
Substantive enough to read concretely (a complete, if rough, live-face-recognition attendance flow with role dashboards and CSV export) but it is a small single-author FTC-team hobby app, not FRC, with security anti-patterns (base64 "password hashing", unenforced admin flag, open coach registration) and no integrations. Worth stealing: the daily+lecture dedup key for check-in state, the soft-delete-preserves-history pattern for roster changes, and the separate IN/OUT station concept — everything else (blocking recognition loop, password handling, lack of FKs) should be redone, not copied.

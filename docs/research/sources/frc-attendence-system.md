# FRC 1164 Attendance System — Source Survey

**Repo:** JZRod/FRC-Attendence-System — https://github.com/jzrod/frc-attendence-system
**Surveyed-at:** 14676f387413b70ff02f3de954dfa65ce7c9e421 (get via: gh api repos/JZRod/FRC-Attendence-System/commits --jq '.[0].sha')
**Permalink form:** https://github.com/JZRod/FRC-Attendence-System/blob/14676f387413b70ff02f3de954dfa65ce7c9e421/<path>
**Stack:** Python 3 + PyQt6 desktop GUI (despite one filename saying "tkinter", the active/current app is PyQt6), CSV files for attendance/guest logs, JSON for students/config, PyInstaller for building a Windows .exe, Inno Setup for a Windows installer. A separate legacy Flask web-kiosk variant also exists.
**License:** MIT (`LICENSE.txt` present, copyright Josh Rodriguez, 2025) — safe to take direct inspiration from patterns/structure, but per project ground rules we recreate rather than copy code.
**Last activity:** pushed_at 2026-04-12 (repo actively maintained/rebuilt multiple times; contains several parallel/duplicated build folders)
**FRC team:** Team 1164, "Project NEO" (per README)
**Areas:** (1) time/attendance — primary and only area this repo substantively covers. No people/roster management beyond a flat name list, no integrations, no communication, no parts/PO, no manufacturing tracking.

## Purpose
A single-machine, kiosk-style check-in station for FRC meetings: a fullscreen touch-friendly grid of student name buttons that team members tap to record "Present" for the day, plus a lightweight guest sign-in flow and a PIN-gated admin panel for roster/settings/backup management. Designed to run as a compiled .exe on a shop-floor Windows PC, not a hosted multi-user web app.

## Auth & Roles
- No user accounts or per-person login — anyone can tap any name to check themselves in (honor system, single shared kiosk).
- One global **Admin PIN** (default `"1234"`, stored in plaintext in `data/config.json`) gates the admin panel (`admin_panel()`, `Executable (Current)/FRC-1164-Attendance-System.py:923`). No hashing, no lockout/rate-limiting, no audit log of who used the PIN.
- No role tiers beyond "everyone" vs "admin PIN holder."

## Data Model
Entirely file-based, no database:
- **Attendance records** — `data/attendance.csv` with columns `Date, Name, Status`. Each check-in is a row; a synthetic `"--- NEW DAY ---"` marker row is inserted whenever the date rolls over (`append_new_day_section()`, line 336) to make the flat CSV visually separable by day while keeping one file.
- **Students** — `data/students.json`, just a flat JSON array of name strings (no student ID, grade, contact info, or subteam field in the current build — an older Flask variant used `{"101": "Alice", ...}` ID→name dict instead).
- **Guests** — `data/guests.csv` with columns `Date, Name, Email`; guest sign-ins also get appended to the students list so a guest can self-check-in again without re-entering info.
- **Config** — `data/config.json`: admin PIN, header color, logo/csv/students/guests file paths, backup folder + interval/retention settings.
- No relational structure — "already checked in" is computed by linear-scanning the in-memory CSV rows for `(Date, Name, Status=="Present")` matches (`already_checked_in()`, line 296).

## Features
### Time/attendance
- Fullscreen kiosk home screen: alphabetized 3-column grid of student buttons; tapping toggles Present/removed for *today only*, never touching past days (`checkin()` / `mark_attendance()`, lines 366, 858). Checked-in students turn green (`#326B20`).
- Live search box that filters the button grid as you type (`on_search_change()`, line 786).
- Guest sign-in button opens a name/email prompt, logs to `guests.csv`, and auto-adds the guest to the main roster for future taps (`guest_sign_in()`, line 864).
- Automatic day-rollover handling while the app is left running: a `QTimer` polls every 30s, and when the date changes it inserts a new-day CSV marker and rebuilds the button grid so yesterday's "present" highlighting clears (`schedule_daily_check()` / `on_day_change()`, lines 689–731).
- Admin → Attendance tab: tabular view of the raw CSV (`setup_attendance_tab()`, line 984) and a CSV export/download button (`download_csv()`, line 1847).
- Admin → Import attendance CSV to bulk-load/merge external records (`import_attendance_data_pyqt()`, line 1683).
- Configurable automatic backups: admin picks a backup folder, sets retention (days) and interval (hours); a background `QTimer` copies the CSV/JSON/config/assets into a timestamped subfolder on schedule, and prunes folders older than the retention window (`perform_backup()`, `cleanup_old_backups()`, `start_backups()`, lines 2161–2266).
- Fullscreen/kiosk mode toggle (Escape/F11) so the check-in station can't easily be minimized by students (`setup_fullscreen()`, `toggle_fullscreen()`, lines 734, 776).

### People/roster (thin, bundled with attendance rather than separate)
- Admin → Students tab: add/edit/delete a student name (`add_student_pyqt()`, `edit_student_pyqt()`, `delete_student_pyqt()`, lines 1199–1259); bulk import students from a file (`import_students_data_pyqt()`, line 1259).
- No fields beyond name — no grade, contact info, parent info, or team-role association.

### Settings / branding
- Admin → Settings tab: change admin PIN, relocate the CSV/students/guests files, swap the header logo image, change header accent color (`change_admin_pin_pyqt()` through `change_header_color_pyqt()`, lines 1486–1683).
- On startup, `init_files()` auto-migrates any previously-configured students/guests files that live under the user's Documents folder into the app's local `data/` folder (lines 165–217) — a defensive move against the original developer's earlier design storing files outside the app directory.

## Integrations
None. No Slack/Discord/email/SMS, no calendar, no The Blue Alliance, no cloud sync. The one legacy `Web Server/Web1.py` file is a small self-contained Flask app reimplementing the same check-in flow as a local web page (own CSV/JSON files, own PIN, Flask session flash messages) — not wired to anything external, and appears to be an earlier/parallel prototype rather than the maintained app.

## Notable Implementation Details
- Repo hygiene is poor for reuse-by-reading: multiple parallel copies of the app exist (`FRC-1164-Attendance-System.py`, `FRC-1164-Attendance-System - tkinter.py`, `Executable (Current)/`, `Executable (OLD)/`, a `TEST/` folder, and committed PyInstaller `build/`/`dist/` output plus a compiled `.exe`, i.e. actual binaries checked into git). Treat `Executable (Current)/FRC-1164-Attendance-System.py` as the canonical current source; everything else looks like drift/history left in place.
- Despite one filename literally saying "tkinter," the current/maintained implementation is PyQt6, not tkinter — don't assume the filename.
- "Toggle to remove" check-in (tapping an already-present name un-marks them) is a nice low-friction UX pattern worth reusing conceptually: no separate "undo" screen, same button does both directions.
- Day-boundary handling via an in-file marker row plus filtering strictly by `Date` column is a simple, robust pattern for "flat CSV, but still get daily semantics" — worth the idea, not the CSV-as-database implementation, for any real system.
- Security is essentially theatre: a 4-digit PIN in plaintext JSON, no audit trail, no encryption, single shared machine trust model. Fine for a kiosk in the team shop, not a pattern to carry into anything network-facing.
- Backup implementation is a straightforward "copy known files to timestamped folder + prune older than N days" pattern (lines 2161–2237) — reasonable minimal reference for any local backup feature.
- Scale is trivially small (one team, dozens of students, CSV-as-truth) — nothing here demonstrates handling concurrent writers, larger rosters, or multi-team/multi-season data.

## Verdict
Substantive, working, MIT-licensed single-team attendance kiosk with real (if simple) feature code — worth mining for two concrete ideas: the toggle-based tap-to-check-in UX and the "insert a day-boundary marker row" pattern for keeping daily semantics in a flat log — but it's UI/CSV plumbing more than architecture; nothing here (auth, data model, integrations) rises above what a from-scratch redesign would already choose.

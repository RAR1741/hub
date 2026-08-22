# frc-attendance — Source Survey

**Repo:** teaaqueenn/frc-attendance — https://github.com/teaaqueenn/frc-attendance
**Surveyed-at:** 9802ea1fc7d6d8c992f4437b99ca5ab047471c7a
**Permalink form:** https://github.com/teaaqueenn/frc-attendance/blob/9802ea1fc7d6d8c992f4437b99ca5ab047471c7a/<path>
**Stack:** Python, OpenCV (`cv2`), `face_recognition` (dlib-based), `numpy`. No web framework, no database, no build system.
**License:** none (all rights reserved) — ideas only. No LICENSE file present.
**Last activity:** 2024-08-11 (single-session repo; only commit)
**FRC team:** unknown (README credits "Mr. Cloos" as a mentor; no team number given)
**Areas:** time/attendance (only)

## Purpose
A student proof-of-concept for taking meeting attendance via real-time webcam face recognition instead of manual sign-in: it detects faces in a live video feed, matches them against a small hardcoded roster of pre-encoded photos, and logs each recognized person once per run to a text file with a timestamp.

## Auth & Roles
None. No login, no roles, no multi-user concept — it's a single local script run by whoever has the webcam.

## Data Model
No database. "Data" is:
- `practicePhotos/*.png` — one reference photo per known person (8 people), committed to the repo.
- In-memory Python lists `knownFaceCode` (face encodings) and `knownFaceNames` (strings), built by hardcoding each person's name and image path at the top of the script.
- `detectedNames.txt` — flat append-only log of `"<Name> - <timestamp>"` lines, the only durable output.

## Features
- **time/attendance**
  - Live webcam face detection and recognition against a fixed roster: `frcAttendance.py` (basic version, prints matched name per frame to stdout only, no persistence).
  - Confidence-scored recognition with on-screen overlay: `frcAttendanceWithConfidence.py` — draws a bounding box and `Name (confidence%)` label on the video feed using `cv2.rectangle`/`cv2.putText`.
  - Attendance logging: `frcAttendanceWithConfidence.py` writes to `detectedNames.txt` only when confidence score `> 61` (computed as `(1 - face_distance) * 100`), and only once per person per process run via an in-memory `detectedNames` set — a re-detection later in the same session is silently skipped, and the file is never de-duplicated or dated per session (each run appends, doesn't reset).
  - Roster enrollment is fully manual/hardcoded: adding a person means editing the script to add an image path, call `face_recognition.face_encodings`, and append to both parallel lists — no config file, CLI flag, or database backing it (`frcAttendance.py`, `frcAttendanceWithConfidence.py`).

## Integrations
None. No calendar, Slack/Discord, email/SMS, or Google integration. Local webcam only via OpenCV.

## Notable Implementation Details
- Image paths are hardcoded absolute Windows paths (`C:\Users\27GracieF\Documents\GitHub\frc-attendance\practicePhotos\...`) — the script cannot run on another machine or checkout without editing every path.
- No error handling anywhere: a missing webcam, missing image file, or zero faces in a reference photo (`face_encodings(...)[0]` on an empty list) will crash immediately.
- The "confidence" metric is just `1 - face_distance`, a common but crude proxy that isn't a true probability; the `> 61` threshold is an arbitrary hand-picked constant with no calibration notes.
- Session-scoped dedup means the tool is meant to be run once per meeting and restarted for each new session — it has no concept of "today's meeting" vs "yesterday's," so a long-running process is required per attendance-taking event, and `detectedNames.txt` mixes all runs together with no per-session boundary marker.
- README is written as a personal narrative/journal (class time spent installing the library, hardware used, difficulty with people who have beards) rather than documentation — no setup/run instructions, no requirements.txt/dependency list.
- `frcAttendance.py` (the non-confidence version) has a stray trailing backslash after `maxChengFaceCode = face_recognition.face_encodings(maxChengImage)[0]\` that is harmless here (next line is blank) but reflects the script's copy-pasted, not-linted nature.

## Verdict
Thin: a two-script student prototype with no persistence layer, no auth, no config, hardcoded absolute paths and a fixed 8-person roster — not a system to emulate structurally. The only idea worth stealing is the concept itself: face-recognition-based passive attendance capture (webcam → encode → match → confidence-threshold → timestamped log) as a lightweight alternative/supplement to manual check-in, which a real implementation would need to harden considerably (dynamic roster management, per-session log boundaries, error handling, no hardcoded paths).

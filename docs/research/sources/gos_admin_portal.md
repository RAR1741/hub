# GoS Admin Portal — Source Survey

**Repo:** geekygirlsarah/gos_admin_portal — https://github.com/geekygirlsarah/gos_admin_portal
**Surveyed-at:** dc2b6669aeff19bd5c56cd32e465c928e7a3485f
**Permalink form:** https://github.com/geekygirlsarah/gos_admin_portal/blob/dc2b6669aeff19bd5c56cd32e465c928e7a3485f/<path>
**Stack:** Python 3.11+ / Django 5.2, django-allauth (email-OTP auth), Bootstrap 5, PostgreSQL (prod) / SQLite (dev), Pillow, openpyxl, Fernet (cryptography) field-level encryption, Quill rich-text editor (vendored)
**License:** none (all rights reserved) — no LICENSE file in the repo. Ideas only, do not copy code.
**Last activity:** 2026-08-22 (commit pushed same day as survey; actively maintained)
**FRC team:** "GoS" = Girls of Steel Robotics (`leads@girlsofsteelrobotics.org` in source), an FRC team running multiple youth programs
**Areas:** (1) time/attendance — full kiosk-based RFID/name attendance system; (2) people/rosters — the core `programs` app (students, adults/mentors/parents, schools, teams, fees). Also touches communication (transactional email) and lightly touches integrations (address geocoding via Mapbox/Nominatim), but has no FRC-specific third-party integrations (no TBA/Onshape/Slack).

## Purpose
A centralized Django admin portal for a multi-program youth robotics organization: manages student/parent/mentor rosters, per-program fees and sliding-scale payments, a public multi-step application/onboarding wizard, RFID/kiosk-based attendance tracking (including visitors from other teams), outreach event signups, and guest-form intake — with heavy emphasis on encrypted PII, granular role-based field permissions, and an immutable audit log.

## Auth & Roles
- **Authentication:** django-allauth with a custom adapter (`GoSAdminPortal/adapter.py`) — passwordless email OTP login (6-digit code emailed, entered at `/accounts/login/`), no passwords for most users. Kiosk unlock uses the same OTP mechanism scoped per-kiosk (see below).
- **Global login enforcement** via `GoSAdminPortal/middleware.py` — every view requires auth by default except an explicit allowlist (public apply wizard, kiosk pages, guest forms).
- **Roles:** derived dynamically in `programs/permission_views.py::get_user_role()` — `LeadMentor` (superuser or `LeadMentor` group), `Mentor`, `Parent`, `Student`, `Alumni`, resolved from the linked `Adult`/`Student` profile (with Django group fallback). A person can hold multiple flags (`is_mentor`, `is_parent`, `is_alumni`) simultaneously; `_user_adult_flag()` checks each independently rather than collapsing to one role.
- **Field-level permission matrix:** `RolePermission` model (`programs/models.py`) — a `(role, section)` → `(can_read, can_write)` grid covering ~18 sections (student identity, health/medical, background checks, attendance, payments, sliding scale, etc.), editable by Lead Mentors at runtime (`programs/migrations/0047-0048`, `0089`). Enforced via `can_user_read`/`can_user_write`/`can_user_delete` helpers used throughout every view (e.g. `attendance/views.py`).
- **Kiosk auth is separate from user auth:** a `KioskConfig` is "unlocked" by any authorized mentor via an HttpOnly, server-side session cookie (`attendance/kiosk_utils.py`) — no API key ever reaches the browser; `KioskDevice.api_key` exists for server-to-server API clients only.

## Data Model
Core roster (`programs/models.py`):
- `Program` — a season/program (has `ProgramFeature` M2M toggles like `attendance`, `discord`, `background-checks`, `outreach`, `signout`).
- `Student` — encrypted medical/allergy fields (`EncryptedTextField`), school FK, graduation year, background clearances, race/ethnicity M2M, documents.
- `Adult` — unified parent/mentor/alumni record (`is_mentor`, `is_parent`, `is_alumni`, `mentor_active`, `login_enabled` flags) — replaced an earlier separate `Mentor` model (migration `0043_migrate_mentors_to_adults...`).
- `AdultStudentRelationship` — join table (parent/guardian/emergency-contact linkage, primary/secondary contact ordering).
- `Enrollment` — Student × Program, plus `Team`/`Crew`/`SubTeam` sub-grouping.
- `School`, `SchoolDistrict`, `AddressGeocode` (lat/lng cache for map view).
- `Fee`, `Payment`, `FeeAssignment`, `SlidingScale`/`SlidingScaleSettings`/`TaxForm` — dues and income-based discount workflow.
- `BackgroundCheck`, `MentorAgreement`/`MentorAgreementAcceptance`/`MentorAgreementSubmission`, `StudentDocument`/`ProgramDocument`.
- Encrypted field types (`EncryptedFileField`, `EncryptedTextField`, `EncryptedCharField`) built on Fernet, keyed by a rotatable `FILE_ENCRYPTION_KEY` env var, with a documented re-encryption path (`applications/management/commands/reencrypt_student_medical.py`).

Attendance (`attendance/models.py`):
- `KioskConfig` — one public kiosk URL per Program.
- `KioskDevice` — API-key-bearing device record for the versioned API (`api_key`, `location`).
- `RFIDCard` — UID → `Student` XOR `Adult` (DB `CheckConstraint` enforces exactly one owner), `is_active` flag, UID lookup tolerates stripped leading zeros (`attendance/services.py::resolve_card_by_uid`).
- `AttendanceEvent` — raw IN/OUT/AUTO tap log, tied to `program`, optional `student`/`adult`/`visitor_name`+`visitor_team_number`, `rfid_uid`, `kiosk`, `source`.
- `AttendanceSession` — derived open/close session with `duration_minutes`, `opened_by_event`/`closed_by_event` FKs back to the events that created/closed it; partial indexes for "currently open session per student/adult" lookups.

Audit (`audit/models.py`): append-only `AuditLog` (actor, event enum, resource_type/id/repr, before/after JSON diff), `save()`/`delete()` overridden to forbid mutation, mirrored to a Python logger.

## Features
**Time/attendance:**
- Kiosk sign-in flow at `/kiosk/<id>/` (`attendance/kiosk_views.py`, `templates/kiosk/signin.html`) — full-screen public page, locked until a mentor authenticates.
- Kiosk unlock via emailed 6-digit OTP scoped per-kiosk, cached with a 10-minute TTL, sets an HttpOnly 7-day cookie (`api/kiosk_views.py::kiosk_request_code/kiosk_unlock/kiosk_lock`, `attendance/kiosk_utils.py`).
- RFID tap-to-toggle IN/OUT: `attendance/services.py::auto_in_or_out()` auto-closes stale sessions from previous days (assumes a 1-hour default duration if someone forgot to sign out), then opens/closes today's session; UID resolution tolerates leading-zero variants and self-heals card records on match (`resolve_card_by_uid`).
- Visitor sign-in (non-roster people, e.g. other FRC/FTC/FLL teams) with a free-text name + team number, no RFID/account required (`AttendanceEvent.visitor_name`/`visitor_team_number`).
- Kiosk member/name lookup and "who is here now" board (`api/kiosk_views.py::kiosk_lookup`, `kiosk_who_is_here`; `templates/attendance/who_is_here.html`).
- Per-student attendance CRUD with permission-gated create/update/delete and program-scoped session editing (`attendance/views.py::student_attendance_view`).
- Weekly/total hours computation (`attendance/services.py::get_attendance_stats`), gamified display suppressed for non-students (mentors/visitors don't get an hours readout on kiosk taps).
- Attendance summary/dashboard and hours-visualization views for mentors (`templates/attendance/mentor_dashboard.html`, `templates/attendance/hours_visualization.html`, `templates/attendance/summary.html`).
- RFID card management UI to (de)assign cards to students/adults (`templates/attendance/rfid_management.html`).
- CSV sample/import support for attendance (`templates/samples/attendance_sample.csv`).

**People/rosters:**
- Unified `Adult` model covering mentors, parents, and alumni with independent boolean flags rather than a single role (supports a parent who is also a mentor).
- Student/adult list, detail, and form views grouped by grade/school (`templates/students/by_grade.html`, `by_school.html`), with dual-listbox multi-select widgets for team/subteam assignment (`programs/static/js/dual-listbox.js`, `programs/widgets.py`).
- CSV bulk import/export for students, parents, mentors, schools with downloadable sample templates (`programs/views/imports.py`, `templates/samples/*.csv`).
- School and school-district management with merge tooling for de-duplication (`programs/views/schools.py`, `templates/schools/merge.html`, `templates/schools/district_*.html`).
- Parent merge tooling for duplicate-guardian cleanup (`templates/parents/merge.html`).
- Address geocoding (Mapbox/Nominatim pluggable backends) with a DB-backed cache keyed by normalized address, feeding a students-by-location map view (`programs/utils/geocoding.py`, `templates/programs/map.html`).
- Background-check tracking with types/expirations (`BackgroundCheckType`/`BackgroundCheck`).
- Mentor agreement e-signature workflow (`MentorAgreement`/`...Acceptance`/`...Submission`, `templates/mentor_agreement.html`).
- Fees, payments, and income-based sliding-scale discount applications with lead-mentor review queue and PDF/print views (`programs/views/finances.py`, `templates/programs/sliding_scale_review_*.html`, `balance_sheet_print.html`).
- Public multi-step application/onboarding wizard (`applications/` app) — student + parent info collection, duplicate-email detection, parent handoff links, staff review/approve/decline with templated emails, later conversion into `Student`/`Adult`/`Enrollment` records (`applications/services.py`, `applications/views/*`).
- Outreach event management with shift-based signups and capacity limits (`outreach/models.py`, `outreach/views.py`).
- Guest form intake with public submission + staff review workflow (`guest_forms/`).
- Andrew ID (CMU account) tracking as an optional per-program feature (`programs/views/andrew_ids.py`).
- Dynamic per-program feature flags (`ProgramFeature` M2M) gate optional UI sections (attendance, Discord, background checks, CMU Andrew ID, outreach, sign-out sheets) without code branching per program.

## Integrations
- No FRC-ecosystem third-party integrations (no TBA, Onshape, GitHub, etc.).
- Outbound transactional email only (OTP login codes, application status emails, sliding-scale notifications) via Django's `send_mail`/SMTP (`programs/utils/notifications.py`).
- Optional external geocoding services (Mapbox or OpenStreetMap Nominatim) for address-to-map-pin lookups, pluggable via `GEOCODING_BACKEND` setting (`programs/utils/geocoding.py`).
- Deployed on Render (per README) with Render's managed PostgreSQL.

## Notable Implementation Details
- **Field-level encryption with a documented rotation path**: custom `EncryptedFileField`/`EncryptedTextField`/`EncryptedCharField` wrap Fernet; README explicitly calls out that rotating `FILE_ENCRYPTION_KEY` requires a data migration to re-encrypt existing rows, and a management command (`reencrypt_student_medical.py`) exists for exactly that.
- **Kiosk security model is worth stealing**: the browser never holds an API key — only an HttpOnly cookie set after OTP-based mentor unlock — while a separate `KioskDevice.api_key` exists for genuine server-to-server callers. Good separation for a public-facing physical kiosk.
- **RFID UID normalization**: cards are looked up by exact UID first, then by the UID with leading zeros stripped, and a match on the stripped form triggers a self-healing update to store the canonical full UID — handles inconsistent reader firmware without manual data cleanup.
- **Auto-closing stale sessions**: `auto_in_or_out()` closes any session left open from a previous day (assuming 1 hour) before deciding whether the current tap is an IN or OUT — prevents "forgot to sign out" from silently corrupting hours totals indefinitely.
- **Dynamic RBAC via a DB-backed permission matrix** (`RolePermission`) rather than hardcoded per-view role checks — lets Lead Mentors change what Parents/Mentors/Students can read or write per data section without a deploy. A model worth emulating for teams with sensitive PII (medical, background checks) alongside less-sensitive data (basic contact info).
- **Immutable audit log** enforced at the model layer (`save()`/`delete()` overridden to raise) rather than relying on convention, with before/after JSON diffs — plus a mirrored stdout/stderr logger stream for external log aggregation.
- **Program feature flags as a many-to-many** rather than per-program boolean columns — keeps `Program` schema stable as new optional modules (Discord, background checks, outreach, sign-out sheets) are added.
- Heavy test suite (dozens of `tests/` files per app, integration "story" tests) and a full local CI pipeline (flake8, black, isort, bandit, semgrep, safety, `manage.py check`) run via cross-platform scripts (`run_ci.sh/.ps1/.bat`) — a solid template for CI hygiene on a volunteer-maintained team codebase.
- No LICENSE file despite being a real, actively-developed, tested Django app — treat all patterns above as ideas to reimplement, not code to copy.

## Verdict
Substantive and directly relevant: this is the most complete attendance+roster reference found so far — steal the kiosk OTP-unlock/cookie model, the RFID UID-normalization/self-healing lookup, the auto-close-stale-session logic, the dynamic per-role/per-section permission matrix, and the encrypted-field-with-rotation-path pattern. No license file means ideas only, not code reuse.

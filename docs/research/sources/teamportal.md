# TeamPortal (Aaron691) — Source Survey

**Repo:** Aaron691/TeamPortal — https://github.com/Aaron691/TeamPortal
**Surveyed-at:** 2b516a194fe1fb2d7b40842ce132ddf405cff609
**Permalink form:** https://github.com/Aaron691/TeamPortal/blob/2b516a194fe1fb2d7b40842ce132ddf405cff609/<path>
**Stack:** Static HTML + vanilla JS, Bootstrap 4 + Tailwind 1.x (both loaded via CDN) + Font Awesome 4; no backend, no build tooling, no framework. `scripts.js` holds hard-coded mock data (`studentData`, `announcements`, `events`, `registeredEvents`) standing in for a database.
**License:** none — no LICENSE file present; ideas only, no code reuse.
**Last activity:** 2020-09-29 (pushed_at); repo created 2020-09-22. Single small commit history, appears to be an unfinished class/hackathon-style prototype.
**FRC team:** unknown (generic "Robotics" branding in page titles; no team number in README or pages; README is a single line, `# TeamPortal`)
**Areas:** people/rosters (primary), time/attendance (primary), communication (secondary — announcements + calendar), parts ordering/POs (none), part design/manufacturing (none), third-party integrations (icons only, not implemented)

## Purpose
A prototype "team management portal" mockup for an FRC-style robotics team: lets students log build/outreach/competition hours, maintain a profile with parent/guardian consent and contact info, sign up for outreach events, and gives mentors/leadership/admin views to track team-wide compliance (permission slips, GPA, attendance, evaluations) and generate simple demographic reports. It is a front-end-only wireframe — almost nothing is wired to real data or a backend.

## Auth & Roles
- **Auth:** none functional. `index.html` has an email/password login form whose button (`nextPage()`) just does `window.location.href = "./profile.html"` — no credential check at all. `register.html` has a name/email/password/confirm form with a Google reCAPTCHA v2 widget (hardcoded site key) and a radio choice of "I am a student" / "I am a mentor", but the submit handler (`onSubmit(token)`) references a `demo-form` id that doesn't exist on the page — registration is non-functional. `resetPassword.html` similarly just has a "SEND EMAIL" button with no handler.
- **Roles (data-model only, not enforced):** `studentData` entries carry `account_type` ("Student") and `access_type` ("Normal"), plus a `student: true` boolean. Nav bars expose "Leadership" and "Admin" dropdown menus identically on every page regardless of any session/role state — there is no client-side gating, so any visitor sees Admin/Leadership links. `profile.html` has a "Student View" checkbox (`changeView()`) that toggles CSS classes (`student-input` / `mentor-input`) to show/hide student-only vs mentor-only profile fields — this is the only role-conditional UI in the app, and it's a manual toggle, not derived from an authenticated identity.
- **Enforcement:** none. No server, no route guards, no token checks anywhere.

## Data Model
All data lives in `scripts.js` as in-memory JS arrays/objects (mock/seed data, looks Mockaroo-generated):
- **`studentData[]`** — one object per person: `_id`, `name`, `current_school`, `current_grade`, `current_gpa`, `eigth_grade_school`, `personal_email`, `cell_phone`, `home_phone`, `street`/`city`/`state`/`zipcode`, `birthdate`, `gender`, `race`, `ethnicity`, `student_consent` (bool), `dietary_restrictions`, `health_restrictions`, `parent_one`/`parent_two` (each `{name, phone, email, consent}`), `account_type`, `access_type`, `student` (bool).
- **`announcements[]`** — `{name, date, time, content}` — free-text team announcements.
- **`events[]`** — `{title, date, time, location}` — calendar entries (all "Zoom" locations, reflecting COVID-era virtual meetings).
- **`registeredEvents[]`** (referenced in `outreach.html` inline script, not shown in the truncated `scripts.js` excerpt but consumed there) — `{_id, name, date, time, role}` — a student's signed-up outreach events.
- No hours/attendance records data structure exists yet — `my-hours.html`, `submit-hours.html`, and the tracker pages show only static placeholder numbers/percentages in the markup (e.g. "Total Hours: 700:20", "Zoom Meeting Attendance: 85%") with no backing array or calculation logic.
- No relational structure (no foreign keys/joins) — everything is a flat array with no linkage between announcement author, event attendee, and student record beyond name strings.

## Features
**People / rosters**
- Student profile form (`profile.html`) capturing directorate, school, grade, GPA, 8th-grade school (recruitment-pipeline tracking), contact info, address, birthdate, gender, ethnicity, dietary/health restrictions, student consent, and two-parent contact + consent blocks — `profile.html`, `scripts.js` (`submitProfile()`).
- "Student View" toggle on the profile page to show/hide student-specific vs. mentor-specific fields via CSS class swap — `profile.html` (`changeView()`).
- Registration page with student/mentor role selection at signup — `register.html`.
- Admin **Users** page: a grid list of accounts (`id="list"`) with an "Add User" style button; population logic not implemented — `admin/users.html`.
- Admin **Team Tracker**: per-student compliance dashboard (address, hours, Zoom/directorate attendance, quad-chart completion, STIMS registration, GPA standing, director/mentor evaluation checkboxes, induction requirements, champs travel + survey, documentary waiver, competition permission slips) plus a **"New Season" reset workflow** that (per its confirm-modal copy) downloads the whole tracker to Excel, then clears consents, hours/requirements data, leadership checkboxes and GPA, and auto-increments every student's grade (rolling 12th-graders to "Student (Alumni)") — `admin/team-tracker.html`.
- Admin **Mentor Tracker**: parallel tracker page scoped to mentors (same nav pattern) — `admin/mentor-tracker.html`.
- Leadership **Team Tracker**: a searchable/filterable roster list (`placeholder="Student's Name"`) with per-row "Show" buttons opening two modals — a **profile modal** (name, directorate, school, grade, rookie flag, email, cell/home phone, birthdate, dietary/health restrictions, both parents' name/email/phone) and an **hours modal** (total/outreach/preseason hours, induction, Zoom/directorate attendance %, quad chart, consent, STIMS, academic standing, permission slips, documentary waiver, class/regional/championship eligibility) plus disabled read-only checkboxes for tracked requirements — `leadership/team-tracker.html`.

**Time / attendance**
- Submit-hours form: date picker, start/end time pickers, an "Hours Type" dropdown, and a mandatory description field (required for "Work at Home and Outreach" per placeholder text) — explicitly noted in an HTML comment as *"this form isn't hooked up to anything"* — `submit-hours.html`.
- My Hours dashboard: total hours, outreach hours, preseason hours, induction/eligibility checklist (handbook consent, STIMS registration, academic standing, preseason/competition permission slips, documentary waiver, class/regional/championship eligibility), Zoom and directorate meeting attendance percentages, quad-chart completion, and a per-week Build Season / Competition Season hours breakdown, plus a "Download Hours" export button (unwired) — `my-hours.html`.
- Configurable hours-type taxonomy in Settings (Team Meeting, Project Work, Outreach, Competition, Training) with an "Add Fields" affordance for admins to extend the list — `leadership/settings.html`.
- Configurable "Team Tracker Checkboxes" (Preseason Permission Slip, Competitions Permission Slip, Waiver) as extensible compliance-requirement fields — `leadership/settings.html`.

**Communication**
- Announcements feed rendered from the `announcements[]` array (author, date/time, free-text body) with a "SLACK" branded button (non-functional) suggesting an intended Slack cross-post — `announcements.html`, `scripts.js`.
- Calendar/events list rendered from `events[]` with a "CALENDAR" branded button (Google Calendar icon, non-functional) suggesting intended Google Calendar sync — `announcements.html`.
- Right-column "Summary" widget showing relevant/outreach hours and Zoom/directorate attendance percentages at a glance on the home page — `announcements.html`.
- Outreach sign-up page: dropdown to register for an event plus a role-preference dropdown, and a list of the student's already-registered events with per-row "Remove" buttons (`removeEvent(id)`) — `outreach.html`.
- Leadership **Reports** page: a "Report Generator" with a field-selector dropdown (seen: "Gender") driving a Chart.js (`myChart` canvas) bar/pie-style breakdown, i.e. ad hoc demographic reporting over the roster — `leadership/reports.html`.
- Leadership **Settings** page also exposes a configurable **Directorates** list (Controls, Mechanical, Business, Systems) and a configurable **Schools** list (four named schools), both with "Add Fields" buttons — `leadership/settings.html`.

**Parts ordering / part design-manufacturing**
- Not present at all — out of scope for this repo.

## Integrations
None are actually implemented. The `assets/` folder ships icon images for Slack, Google (Drive + Calendar), Dropbox, Trello, and "FIRST", and the UI has branded buttons ("SLACK" on Announcements, "CALENDAR" on the calendar widget) — but none has a click handler or API call behind it. `register.html` embeds a live Google reCAPTCHA v2 widget script tag with a real-looking site key, though the verifying `onSubmit` callback is broken (targets a nonexistent form id). No backend, no database, no email/SMS, no OAuth.

## Notable Implementation Details
- Entire app is client-only static HTML; "data" is one shared `scripts.js` file of literal arrays — there is no persistence, so any change is lost on reload. A re-implementer should treat this purely as a **UI/IA wireframe reference**, not working code.
- The nav bar (with Home / My Hours / Submit Hours / Outreach Sign-Up / Leadership dropdown / Admin dropdown / profile link / Logout) is duplicated verbatim across every page — a copy-pasted include pattern with no templating, and relative path handling gets fragile once nested under `admin/`/`leadership/` (`./../`).
- Every page loads Bootstrap 4 CDN, Tailwind 1.x CDN, and Font Awesome 4 CDN simultaneously — three separate/overlapping CSS frameworks on one prototype, a good example of what *not* to carry into a real build.
- The "New Season" rollover concept in `admin/team-tracker.html` (bulk export-then-reset: clear consents/hours, bump grade levels, auto-graduate seniors to alumni) is the one genuinely interesting workflow idea worth recreating properly with real transactional semantics (the mock only describes it in a confirmation-modal bullet list; no code executes it).
- Field-taxonomy configurability (hours types, tracker checkboxes, directorates, schools) as leadership-editable lists is a reasonable pattern for a real settings/admin screen, though here it's just static text with inert "Add Fields" buttons.
- No accessibility, no responsive breakpoints tested, no tests, no CI — this is an early/abandoned prototype (one commit range, ~9 days of activity in Sept 2020, `size: 851`KB mostly from the CDN-linked pages and small PNG assets).

## Verdict
Thin — a static, largely non-functional HTML/JS wireframe with no backend and almost no working logic (login, registration, hours submission, and both external-service buttons are all inert). Worth stealing only as an information-architecture reference: the season-rollover/reset concept, the split of student vs. mentor vs. leadership vs. admin dashboard views, and the compliance-checklist field set (permission slips, STIMS, academic standing, evaluations, eligibility flags) are a reasonably complete checklist of what an FRC people/attendance system needs to track, even though none of it is implemented here.

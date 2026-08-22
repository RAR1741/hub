# BSPI BotForge — Source Survey

**Repo:** mojahidmamu/BSPI-BotForge — https://github.com/mojahidmamu/BSPI-BotForge
**Surveyed-at:** 909c9881a112a3ec81d3b98c6bef219afa9d5c35
**Permalink form:** https://github.com/mojahidmamu/BSPI-BotForge/blob/909c9881a112a3ec81d3b98c6bef219afa9d5c35/<path>
**Stack:** React 19 + Vite frontend (Tailwind CSS v4, daisyUI, Framer Motion, React Router 7, Axios, Firebase Auth, Recharts, Socket.io-client). README also documents a Node/Express + MongoDB + Mongoose backend (JWT, Bcrypt, Nodemailer, Multer) — **that backend code is not present in this repository**; the frontend calls a hardcoded `http://localhost:5000/api/...` that exists only as an external/undelivered service.
**License:** none — no LICENSE file in the repo despite the README displaying an "MIT" badge. Per ground rules, no LICENSE file = all rights reserved; treat as ideas-only regardless of the badge claim (flag: ambiguous/unenforceable license claim).
**Last activity:** 2026-07-06 (pushed_at); repo created 2026-04-11.
**FRC team:** Not FRC — this is for the "BSPI Robotics Club" at Bangladesh Sweden Polytechnic Institute (a polytechnic/vocational robotics club, non-FRC). Labeled here as a comparable non-FRC club-ops tool per instructions.
**Areas:** People/rosters (membership applications, directory, roles); Communication (bulk email, notices/announcements); tangential Parts/finance (a "Transactions" income/expense ledger, closer to club treasury than PO/parts-ordering, included for completeness but weakly in-scope).

## Purpose
A public-facing site plus admin console for a robotics club to intake membership applications, showcase members/executives/moderators/alumni, publish notices/events, and (per README) automate approval emails — pitched as a paperwork-to-digital replacement for a student club's membership pipeline.

## Auth & Roles
- Firebase Authentication (Google popup sign-in and email/password) via `src/firebase/firebase.config.js` — `signInWithGoogle`, `signInWithEmail`, `signUpWithEmail`, `onAuthStateChange`.
- `src/Components/context/AuthContext.jsx` wraps Firebase auth state and, on login, calls a (non-existent-in-repo) backend `GET /api/admin/check-admin?email=` to resolve an `isAdmin` boolean — client-trusts whatever that endpoint returns, no token/claims verification shown.
- `src/Components/ProtectedRoute.jsx` — route guard: redirects to `/login` if no Firebase user; only checks authentication, not role/admin status, at the route level.
- Role model (`src/Components/Role.jsx`, `src/Components/AddAdmin.jsx`): `user` / `moderator` / `admin` / `super_admin`, plus a "role upgrade request" workflow (member requests a higher role with a reason; admin approves/rejects). **This entire screen runs on hardcoded dummy arrays** (`dummyUsers`, `dummyRequests`) with the real `axios` calls present but commented out — it is a UI mock, not a working role system.
- `src/Components/Suspended.jsx` / `src/Components/Pending.jsx` — gate screens for suspended or not-yet-approved accounts.

## Data Model
No schema/migrations in-repo (backend absent). Inferred from frontend shapes and README's documented API:
- **Student/Member**: name, email, phone, roll (6-digit, validated client-side), registration (10-digit), department (enum: CST/MT/ET/AT/CWT/CONT), session, cgpa, district, currentJob, skills, socialLink, bloodGroup, photo, status (pending/approved/rejected) — `src/Components/Contribute/MemberForm.jsx`, `src/Components/AllMembers/MemberDetails.jsx`.
- **Admin/User**: name, email, role, isActive, photoURL, createdAt, lastLogin — `src/Components/Role.jsx`, `src/Components/AddAdmin.jsx`.
- **RoleRequest**: userId, requestedRole, currentRole, reason, status — `src/Components/Role.jsx`.
- **AuditLog**: action (e.g. `USER_LOGIN`), adminEmail/adminName, targetType, targetId, timestamp — `src/Components/AuditLogs.jsx` (also dummy-data only).
- **Transaction** (club treasury, not parts ordering): type (income/expense), category (Membership Fee, Workshop Registration, Donation, Competition Fee, Project Funding, Equipment Purchase, Event Cost, Travel Allowance, Food & Refreshments, Printing, Other), amount, user{name,email,roll}, paymentMethod (bkash/nagad/rocket/bank/cash — Bangladesh-specific mobile payment rails), description, status — `src/Components/Transactions.jsx`, `src/Components/Admin/CreateTransactionModal.jsx`. **Persisted only to `localStorage` (`bspi_transactions` key)**, not a real ledger.
- **Event**: title, date, venue, type (Competition/Workshop/Seminar/Other), description, status (upcoming/...) — `src/Components/Admin/ManageEvents.jsx`.
- **Notice**: id, title, description, date — `src/Components/CreateNotice.jsx`, persisted to `localStorage` (`notices` key), not backend.

## Features
**People / rosters:**
- Public membership application form with photo upload and format-constrained fields (roll must be exactly 6 digits, registration exactly 10, blood-group enum) — `src/Components/Contribute/MemberForm.jsx`.
- Member directory with search/filter by department/status, pagination — `src/Components/AllMembers/AllMembers.jsx`, `src/Components/Admin/AdminMembers.jsx`.
- Individual member profile page with social links (Facebook/LinkedIn/GitHub/Twitter/Instagram/WhatsApp), print/download/share actions, inline edit — `src/Components/AllMembers/MemberDetails.jsx`.
- Application status tracking (pending/approved/rejected) with an email-verification gate before viewing full member details — implied by README's `/api/students/status` and `/api/students/verify-email` endpoints (backend not in repo).
- Admin approve/reject workflow for pending applications, per README's `PUT /api/admin/student-action`.
- Role & permission management screen with role-upgrade request/approve/reject flow — `src/Components/Role.jsx` (dummy-data mock, described above).
- Admin management (add/remove admins by email) — `src/Components/AddAdmin.jsx`.
- Team showcase pages: Executive panel, Moderator panel, Alumni section — `src/Components/Executive/Executive.jsx`, `src/Components/Moderator/Moderator.jsx`, `src/Components/AboutUs/AboutUs.jsx`.
- Audit log viewer (admin action history, filterable by action/date) — `src/Components/AuditLogs.jsx` (dummy data).

**Communication:**
- Bulk email/newsletter composer targeting all members, or filtered by department or blood group — `src/Components/Admin/BulkEmail.jsx`.
- Notices/announcements board, admin-authored, member-facing list — `src/Components/CreateNotice.jsx`, `src/Components/AdminNoticeList.jsx`, `src/Components/Activities/Notices.jsx`.
- Events listing and admin CRUD for events (competitions/workshops/seminars) — `src/Components/Admin/ManageEvents.jsx`, `src/Components/Activities/Events.jsx`.
- Contact page — `src/Components/Contact/Contact.jsx`.

**Other (weakly in-scope / general site):**
- Club treasury ledger (income/expense transactions with local Bangladeshi mobile-payment method tagging) with CSV-style export/detail modal — `src/Components/Transactions.jsx`. Note this tracks club dues/donations, not parts purchase orders — marginal fit to the "parts ordering" area.
- Dark/light theme toggle — `src/Components/Theme/useTheme.js`.
- Public marketing pages: Home/Banner, About Us, Achievements, FAQ, Call to Action, Footer — cosmetic, out of scope for team-ops features.

## Integrations
- **Firebase Authentication** (Google OAuth + email/password) — `src/firebase/firebase.config.js`.
- **Nodemailer** (Gmail SMTP) for approval/rejection and bulk emails — documented in README, not present as backend code in-repo.
- **Socket.io / socket.io-client** dependencies are installed (`package.json`) but no actual usage was found in the surveyed source files — likely planned/unused.
- No Slack/Discord/TBA/Onshape integration.

## Notable Implementation Details
- **The backend does not exist in this repository.** Every admin/member data-fetching screen calls `axios` against a hardcoded `http://localhost:5000/api/...` (no env var indirection despite `VITE_API_URL` being listed as a required env var in the README) — this repo is frontend-only; the README's "Backend Setup" section (`cd backend && npm install`) refers to a directory that isn't in the tree.
- Several "admin" screens that look feature-complete are actually **static/mock data with the real API call commented out**, silently falling back to `setTimeout`-simulated fetches: `Role.jsx` (users, role requests) and `AuditLogs.jsx` (audit log entries). A re-implementer should treat the README's feature/impact claims (e.g., "73% reduction in admin hours") as aspirational marketing copy, not evidence of a working system.
- `Transactions.jsx` and `CreateNotice.jsx` persist to **`localStorage`** rather than any backend — meaning per-browser, non-shared, non-durable state for what are otherwise pitched as multi-admin club records.
- Route protection (`ProtectedRoute.jsx`) only checks Firebase auth presence, not role — admin-only pages appear to rely on either not being routed to non-admins or on unshown page-level `isAdmin` checks; worth checking for authorization gaps if ever adapted.
- Client-side format validation is done via naive regex-stripping (`value.replace(/[^0-9]/g, '')`) rather than input `pattern`/`inputMode`, and duplicated between at least the member form and elsewhere — small but real redundancy.
- Bengali-language code comments throughout (e.g. `// ডামি ইউজার ডাটা` = "dummy user data") mark the mock/placeholder sections explicitly — useful signal for identifying which "features" are real vs. scaffolding when skimming the source.

## Verdict
Marginal: a plausible people/roster + comms feature *list* (application intake, approval workflow, role requests, bulk email, notices, audit log) but the majority of admin-facing "features" are UI mockups over a backend that isn't in the repository, and two "persisted" features (transactions, notices) are actually just `localStorage`. Worth stealing only the *shape* of the membership-application-with-approval-workflow and the department/blood-group-targeted bulk email idea — not worth treating as a reference implementation, since the parts that would prove the pattern works (real API, real auth-gated roles) don't exist here. No LICENSE file, so ideas-only regardless.

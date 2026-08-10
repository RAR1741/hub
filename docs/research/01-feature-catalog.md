# Feature Catalog — Team Hub Research

**Date:** 2026-08-10
**How to use this doc:** For each feature, fill in the **Decision** field: `Need` (v1), `Nice` (later), or `Skip`. Where implementations differ, note your **preferred variant**. Full per-source reports with deeper implementation notes live in [sources/](sources/).

**Sources & shorthand:**

| Shorthand | Source | Stack | License |
|---|---|---|---|
| **GP** | [GatherPack](https://github.com/GatherPack/gatherpack) @ `6f3047d` | Rails 8 / PostgreSQL / Hotwire | MIT |
| **AT** | [AdvantageTrack](https://github.com/Mechanical-Advantage/AdvantageTrack) @ `218e6a1` | Python CherryPy / Google Sheets | MIT |
| **RAR** | [RAR1741/tracking](https://github.com/RAR1741/tracking) @ `89bc811` | React Router 7 SSR / Express / Drizzle / PostgreSQL | none (private) |
| **CH** | [cheesy-hours](https://github.com/Team254/cheesy-hours) @ `518df05` | Ruby Sinatra / MySQL | none (all rights reserved) |
| **CM** | [cheesy-mail](https://github.com/Team254/cheesy-mail) @ `bbc62a0` | Go SMTP daemon / SES | none (all rights reserved) |
| **CP** | [cheesy-parts](https://github.com/Team254/cheesy-parts) @ `034ef59` | Ruby Sinatra / MySQL | BSD 2-Clause |
| **Den** | [den.tigerdynasty.app](https://den.tigerdynasty.app/) (FRC 5010 "Tiger Den") | React/Vite SPA + Node/Express + Caddy (observed from outside) | closed source — no repo found |

File references are `SOURCE: path` relative to each repo's root, pinned at the commit above (see each source doc for permalink form). Den has no code references — its entries cite observed behavior and API endpoints documented in [sources/den.md](sources/den.md).

> **License note:** Only GP, AT (MIT) and CP (BSD-2) carry open-source grants. CH, CM, and RAR have **no license** — we can learn from them but must not copy code. We're recreating features, not porting code, so this mainly matters if we're ever tempted to lift a query or template.

---

## 1. Attendance / Hours Tracking

### 1.1 Kiosk sign-in (tap or type)
Members sign in at a shared device at the shop door.
- **AT** — tap your name from an alphabetized grid on a touchscreen (`www/static/modules/popupMenu.mjs`, `web_server.py`). No auth; identity = tapping a name.
- **CH** — type/scan a student ID into an autofocused field, barcode-scanner friendly (`hours_server.rb` `post /signin`, `views/index.erb`). IP-whitelisted so only the lab kiosk can sign in.
- **GP** — scan an RFID token at a full-screen kiosk; shows your per-period hours, punch in/out buttons (`app/controllers/time_kiosk_controller.rb`, `app/views/layouts/kiosk.html.erb`). Kiosk sits behind a logged-in session.
- Variants differ on **identity mechanism**: name-tap (zero hardware, spoofable) vs student-ID/barcode (cheap scanner) vs RFID card (needs cards + reader).
- **Decision:** ___ · Preferred variant: ___

### 1.2 Sign-out flows & forgotten-sign-out cleanup
- **AT** — self sign-out by tapping your name in "Who's Here"; auto-timeout closes forgotten manual sessions after N hours with a backdated end time (`monitor.py`).
- **CH** — students *cannot* sign themselves out; a mentor signs them out via web UI or SMS. A scheduled sweep (`get /signout_automatic`) closes stragglers as "Automatic - Didn't Sign Out", backdated by a config offset.
- **GP** — self punch-out at kiosk (clamped to period end); managers can punch out a whole period at once; a "flagged punches" screen lists over-long, still-open, and overlapping punches for bulk cleanup (`app/controllers/time_clock_punches_controller.rb` `flagged`).
- **Den** — self clock-out from your own device (single open session enforced); at midnight on a meeting day, open sessions auto-close **backdated to the meeting's end time** — arguably the cleanest forgotten-sign-out policy surveyed.
- Design questions: who may sign a member out, and how are forgotten sessions healed (auto-sweep with backdating vs manual review queue vs both).
- **Decision:** ___ · Preferred variant: ___

### 1.3 Automatic presence detection (Wi-Fi)
- **AT only** — background thread flood-pings the shop IP range, resolves MACs via `arp`, matches registered devices, auto-opens/closes visits (`monitor.py`, `arp.py`). Includes device registration pairing flow with QR code (`web_server.py` `/add`), randomized-MAC detection with per-OS fix instructions, grace periods, and backdated auto-sign-out. Requires an always-on box on the shop LAN — fundamentally incompatible with pure cloud hosting (a small on-site agent posting to a cloud API could replicate it).
- **Decision:** ___

### 1.4 Live "who's here" board
- **AT** — real-time via WebSocket push, distinguishes manual vs auto-detected attendees (`www/static/modules/hereNow.mjs`).
- **CH** — 120-second jQuery poll; anonymous viewers see only IDs, logged-in viewers see names (`get /lab_sessions/open`, `views/signed_in_list.erb`).
- **Den** — "In the shop" live list of currently clocked-in members.
- **Decision:** ___ · Preferred variant: ___

### 1.5 Hours totals & leaderboard
- **CH** — leaderboard of all students by total project hours with session counts (`get /leader_board`); per-student detail page listing every session.
- **GP** — hours shown per time-clock period on person profiles and at the kiosk; period summary report with daily breakdown, distinct-people counts, calendar rendering (`time_clock_periods_controller.rb` `summary`).
- **Den** — totals per subteam plus a team leaderboard; only mentor-confirmed hours count.
- **AT** — no in-app totals; analysis lives in Google Sheets formulas.
- **Decision:** ___ · Preferred variant: ___

### 1.6 Attendance calendar & required/optional days
- **CH only (rich)** — build-day calendar grid: students × build days, color-coded present/absent/excused/optional, attendance rate per student, excused-absence workflow, scheduled build days with required/optional precedence rules, semester windows (`views/calendar.erb`, `queries.rb`, `models/scheduled_build_day.rb`, `models/excused_session.rb`). "My Attendance" self-service page per student.
- **Den (different angle)** — meeting-anchored attendance: meetings come from the team **Google Calendar**, clocking in during a meeting auto-attaches the session to it, and each meeting has an attendance view. No required/excused concept observed, but the calendar-as-source-of-truth idea composes well with CH's policy layer.
- **GP** — general FullCalendar view (events + birthdays + notes + punches) but no required-day/excusal concept.
- **Decision:** ___ · Preferred variant: ___

### 1.6b Manual / offsite hours with mentor verification
- **Den only** — "Log Hours" for offsite work is recorded as *pending* until a mentor verifies; clock-ins outside any scheduled meeting are likewise flagged for review. In-meeting hours are trusted by default. A nice trust model: verification burden only where abuse is possible.
- **Decision:** ___

### 1.7 Time-clock periods (seasons)
- **GP only** — named date ranges (e.g. "2026 Build Season") that scope punches, with per-period permissions; keeps history separated by season. `app/models/time_clock_period.rb`.
- CH instead has a hard-coded `/reset_hours` cutoff date — a lesson in what *not* to do.
- **Decision:** ___

### 1.8 Manual session editing / audit corrections
- **CH** — editors add/edit/delete sessions with arbitrary times and notes; "suspect sessions" report lists sessions > 18h (`get /suspect_lab_sessions`); date-range search.
- **GP** — same via punch CRUD + flagged-punch review; PaperTrail audit log records every change with revert.
- **Decision:** ___ · Preferred variant: ___

### 1.9 SMS interactions
- **CH only** — Twilio webhook: mentors text student IDs to sign them out (batch supported), `gtfo` closes all open sessions, `here` logs a mentor check-in (`post /sms`). README pegs cost ~$1/mo + $0.01/msg.
- **Decision:** ___

## 2. Roster / Membership

### 2.1 Member roster with profiles
- **GP** — richest: Person entity with names, gender/shirt-size (configurable option lists), phone, address, birthday, dietary restrictions, bio, avatar (with webcam capture), tabbed profile pages (`app/models/person.rb`, `app/views/people/`).
- **CH** — minimal Student (ID + name), synced from SSO.
- **AT** — roster rows in a Google Sheet (name, student flag, active flag, grad year).
- **Decision:** ___ · Preferred variant: ___

### 2.2 Teams / subteams hierarchy
- **GP only** — self-referential team tree with team types (icon, custom "manager" title), membership with manager flag, join permissions (admin-added → open-join → requires-approval), membership application/approval queue (`app/models/team.rb`, `membership_application.rb`).
- **Decision:** ___

### 2.3 Roles & permissions (app-wide)
- **RAR** — full RBAC: roles (ADMIN/MENTOR/STUDENT_ADMIN/STUDENT/PARENT/GUEST) × 21 granular permissions, role-permission and direct user-permission joins, admin UI for assignment, permission-gated nav (`database/schema.ts`, `app/lib/user-permissions.ts`).
- **GP** — two boolean flags (admin/architect) + derived manager status + Pundit policies + per-model permission enums.
- **CP** — three-level enum (readonly/editor/admin) + enabled flag; simplest that works.
- **Den** — five roles (`admin`/`mentor`/`lead`/`student`/`guest`) plus server-configured superadmins; **guest read-only mode is server-enforced per endpoint**, not just hidden UI. Members carry role, subteam, grad year.
- **CH/CM** — permission strings from an external SSO.
- **Decision:** ___ · Preferred variant: ___

### 2.4 Authentication
- **RAR** — Better Auth, email/password, cookie sessions (Node-native; closest to our stack).
- **GP** — Devise + OAuth sign-in (Google/Discord/GitHub), toggleable local signup, first-user-becomes-admin, auto-provisioned logins with generated passphrases.
- **CP** — local PBKDF2 + optional WordPress SSO; self-registration with admin approval + email notification.
- **Den** — split by audience: students sign in with a team ID number (low-friction, no passwords for minors), mentors with Google OAuth (allowlisted emails) or ID + PIN; self-service account request queue.
- **CH/CM** — external SSO only.
- Notable sub-features to consider: first-user-admin bootstrap (GP) vs DB-manual bootstrap (RAR's gap); registration-approval queue (CP, Den); admin impersonation with true-user audit (GP); per-audience auth methods (Den).
- **Decision:** ___ · Preferred variant: ___

### 2.5 Parent/child & mentor relationships
- **GP only** — typed directional relationships between people (parent/child, mentor/mentee) with per-type creation permissions (`app/models/relationship.rb`). RAR's permission list hints at the same intent (`child:progress_view`) but nothing is built.
- **Decision:** ___

### 2.6 Badges / training & credentials
- **GP** — badges with types, colors, team scoping, permission-controlled awarding including self-award (`app/models/badge.rb`).
- **RAR** — "learnings management" (areas trained, pending training, coordinating mentor) is the stated goal in `docs/Home.md` but unimplemented.
- **Decision:** ___

### 2.7 RFID / access tokens
- **GP only** — token entities attached to a person (or a hook), duplicate detection, reader-format normalization; used by the kiosk (`app/models/token.rb`).
- **Decision:** ___

## 3. Parts & Purchasing (all CP unless noted)

### 3.1 Structured part numbering
Canonical numbers like `PREFIX-A-0100`/`PREFIX-P-0101` (project prefix + assembly/part letter + zero-padded number) intended as CAD filenames; auto-allocation: assemblies get +100 blocks, parts increment within their parent's block (`models/part.rb` `generate_number_and_create`).
- **Decision:** ___

### 3.2 Assembly hierarchy
Parts nest under assemblies (self-referential tree), breadcrumb chain, sortable listings (`views/part_tree.erb`).
- **Decision:** ___

### 3.3 Manufacturing status pipeline
20 color-coded statuses (designing → material → ordered → drawing → ready → cnc/laser/lathe/mill/… → done), inline AJAX status change from any list (`models/part.rb` `STATUS_MAP`).
- **Decision:** ___

### 3.4 Shop dashboard (kanban)
Live board grouping parts by status, priority-ordered and priority-colored tiles, status filter, 10-second auto-refresh; per-project enable flag (`views/dashboard.erb`).
- **Decision:** ___

### 3.5 Purchasing: order items → vendor orders
Line items auto-group into per-vendor open orders (typing a vendor finds-or-creates the order; blank vendor = "unclassified" bucket), vendor autocomplete, inline editing, Open → Ordered → Received lifecycle with tax/shipping/notes (`post /projects/:id/order_items`, `models/order.rb`).
- **Decision:** ___

### 3.6 Spend & reimbursement reporting
Per-vendor spend stats with drill-down; per-purchaser reimbursed vs outstanding report driven by a `reimbursed` flag + "paid for by" field (`views/order_stats.erb`).
- **GP alternative** — full double-entry-ish ledgers: per-team ledgers with cached balances, entry splitting, inter-ledger transfers, receipts attached to entries, colored tags, budgets matched by tag within budget periods, and Stripe hosted-checkout payments into a ledger. Much heavier; aimed at team finance, not just purchasing.
- **Decision:** ___ · Preferred variant: ___

### 3.7 Purchase-request approval workflow (Den)
- **Den only** — students submit requests (item, qty, unit price, supplier, purchase URL, notes, SKU); status flows `pending` → `approved`/`rejected` → `completed` with decision notes and signed-off-by; **auto-fill from a pasted URL** via a server-side part scraper; reorder/restock prefill from an existing item; approved purchases import into inventory. Complements CP's vendor-order model: Den covers "may we buy this?", CP covers "what did we order and who gets reimbursed?".
- **Decision:** ___

### 3.8 Shop inventory & storage boxes (Den)
- **Den only** — parts catalog with supplier, stock quantity vs low-stock warning point, unit price, SKU, inventory-value rollup; low-stock badge; a registry of physical **storage boxes** each with a label, color tag, and shop coordinate (e.g. `B13`), so every part answers "which box, where"; Google Sheets bootstrap import with column mapping.
- **Decision:** ___

### 3.9 3D print queue (Den)
- **Den only** — job submission with model file upload, quantity, urgency-sorted queue, filament type/color, estimated time; named printer fleet with job assignment; Queued/Printing/Done/Failed/Cancelled lifecycle; per-job activity trail and completed archive.
- **Decision:** ___

## 4. Communications

### 4.1 Mailing lists (email distribution)
- **CM** — receives mail at `parents@`/`students@` addresses, checks sender permission, fans out one SES email per recipient with branded template, per-recipient signed unsubscribe links, reply-forwarding via base32-encoded return addresses, attachment re-hosting, dedup, throttling, Slack cross-post, blog cross-post. A full custom SMTP daemon — high ops burden to recreate as-is; the *feature* (permission-gated announcement email to parent/student lists) can be had with a simple compose-UI + email API instead.
- **GP** — announcement email blast (checkbox on an announcement fans out HTML email) + weekly personalized digest of announcements per user (`announcement_notification_router.rb`, `infodump.rb`).
- **Decision:** ___ · Preferred variant: ___

### 4.2 Announcements (in-app)
- **GP only** — Markdown announcements with visibility windows, team-scoped or global, surfaced on dashboard and team pages.
- **Decision:** ___

### 4.3 Slack/chat notifications
- **CM** — posts student-list mail to a Slack webhook with `<!channel>` ping. Trivial to recreate (one webhook POST).
- **Decision:** ___

### 4.4 Q&A board
- **GP only** — team-scoped questions, threaded replies, one-vote-per-person promoting best answers, close/reopen/move moderation.
- **Decision:** ___

### 4.5 Inbound mailboxes (shared inbox archive)
- **GP only** — registered addresses whose inbound mail (via Postmark) is stored, searchable, with attachments.
- **Decision:** ___

### 4.6 Suggestion box & in-app notifications
- **Den** — public "suggest an idea / report a bug" dialog categorized by app module, reviewed by mentors; per-user notifications for events like new purchase request or new suggestion (`/api/me/notifications`).
- **Decision:** ___

## 5. Events & Calendar

### 5.1 Events with check-ins
- **GP only** — events with types, team scoping, location, times, optional attendance cap, check-ins carrying custom per-event-type fields, drag-and-drop "arrange" board grouping attendees by a field, printable grouped rosters (`app/controllers/events_controller.rb`, `checkins_controller.rb`).
- **Decision:** ___

### 5.2 Team calendar
- **GP** — FullCalendar month/week/list merging events, birthdays, notes, punches; localStorage view toggles.
- **CH** — the attendance-specific build-day calendar (see 1.6).
- **Den** — no in-app calendar UI; meetings are read from the team's Google Calendar and used as the attendance backbone (see 1.6).
- **Decision:** ___ · Preferred variant: ___

### 5.3 Task boards & Gantt (project planning)
- **Den only** — multiple named kanban boards (To Do / In Progress / Done, drag-and-drop) with cards carrying assignee and date ranges; **dependency-aware auto-scheduling** ("blocked by" → card starts the day after its blockers finish); per-board Gantt timeline with unscheduled bucket and today marker.
- **Decision:** ___

## 6. Reporting & Exports

- **CSV exports** — CH: hours CSV and attendance-percentage CSV (`get /csv_report`, `get /csv_attendance_report`). CP/GP/RAR: none.
- **Ad-hoc admin reports** — GP: named Ruby snippets run on demand (powerful but `eval`-based — recreate as saved SQL/typed queries, not code eval).
- **Spreadsheet-native reporting** — AT: all analysis in Google Sheets formulas; the app only writes rows. A lesson worth noting: mentors like spreadsheets — a "sync/export to Sheet" feature may beat in-app charts.
- **Audit log** — GP: PaperTrail on a second database, filterable admin browser, per-change diff and revert. Den: role-gated "Workspace Audit Trail" (`/api/audit`).
- **Decision:** ___ · Preferred variant: ___

## 7. Platform / Admin plumbing (patterns worth copying, not user features)

- **Feature toggles** — GP gates every module (badges, events, ledger, Q&A, …) behind a boolean setting that hides routes/nav/search. Lets us ship v1 small and grow.
- **Runtime settings UI** — GP admin screen for site name, timezone, option lists, toggles (but stored in a PStore file requiring restarts — use a DB table instead).
- **Theming** — GP: logo upload, CSS variables, PWA colors; RAR: Tailwind brand theme + dark mode.
- **PWA** — GP: installable manifest + service worker stub.
- **Kiosk resilience** — AT: offline config cache, connection-status lights, input lockout when the backend is unreachable, WebSocket auto-reconnect. Directly relevant if our kiosk runs on flaky shop Wi-Fi against a cloud backend.
- **Admin impersonation** — GP (`pretender`) with true-user audit trail.
- **Guest read-only mode** — Den: unauthenticated visitors get a server-side downgraded session that can browse everything except role-gated endpoints — great for parents/sponsors, and forces clean server-side authorization from day one.
- **Health endpoint, background-jobs dashboard** — GP (`/up`, Mission Control).
- **Decision (which patterns to adopt):** ___

---

## Stack, cost & hosting

### What the surveyed stacks teach us
- GP (Rails), CH/CP (Sinatra), CM (Go), AT (Python) are all **self-hosted, server-full** designs — always-on processes, some with background threads/daemons. None run on serverless as-is.
- **RAR (React Router 7 + Express + Drizzle + PostgreSQL + Better Auth) is the closest existing attempt to a modern Node stack for exactly our use case** — worth mirroring its choices where they worked (Drizzle migrations, Better Auth, RBAC schema) even though its domain features are unbuilt.
- **Den independently validates the Node choice**: the most feature-complete, actively-used app in the survey is a React SPA + Node/Express API — proof that this stack comfortably carries the whole feature set for a real FRC team.
- No code porting is realistic anyway (Ruby/Go/Python → TS), so stack choice is unconstrained by the sources.

### Requirements the feature catalog implies
1. **Postgres-shaped relational data** (roster, sessions, parts, orders — all heavily relational).
2. **Auth with roles** (email/password + ideally Google OAuth for students).
3. **A kiosk page** that tolerates flaky networks and works on a cheap tablet.
4. **Scheduled jobs** (auto-sign-out sweep, digests) — needs cron support.
5. **Outbound email** (announcements, approvals) — needs an email API; Supabase does not send app email (its built-in email is auth-only).
6. **CSV export** (trivial anywhere).
7. Optional later: SMS (Twilio), Slack webhook, file uploads (receipts, avatars, 3D models → object storage), Google Calendar read (meeting-anchored attendance, as Den does).

### Recommendation: Next.js (or React Router 7) + Vercel + Supabase — your instinct is right, with three additions
| Concern | Choice | Cost (nonprofit/small team) |
|---|---|---|
| App framework | **Next.js on Vercel** (or React Router 7, matching RAR) | Vercel Hobby free tier is fine for a team-sized app; note Hobby is technically for non-commercial use — a non-profit team qualifies in spirit, but Pro is $20/mo if it ever matters |
| Database + auth + storage | **Supabase** (Postgres + Supabase Auth + Storage) | Free tier: 500 MB DB, 50k MAU auth — years of headroom for a team of ~30–100 people |
| ORM/migrations | **Drizzle** (as RAR chose) — plain SQL migrations, type-safe | free |
| Scheduled jobs | **Vercel Cron** (Hobby: daily granularity, limited) or **Supabase pg_cron** (in-DB, any schedule) → use pg_cron for the sign-out sweep | free |
| Outbound email | **Resend** (or Postmark) — required addition; ~free tier 3k emails/mo covers announcements | free–$20/mo |
| Realtime "who's here" board | **Supabase Realtime** (Postgres changes → WebSocket) instead of hand-rolled sockets | included |

Total expected cost: **$0/mo to start**, worst case ~$20–45/mo if the team outgrows free tiers. Custom domain ~$12/yr.

### Alternatives (one sentence each)
- **Self-host on a $5–10/mo VPS (Coolify/Dokku) with Docker Postgres** — wins if you want zero vendor coupling and don't mind being the sysadmin; loses on bus-factor (you're the only operator) for a student org.
- **Cloudflare Pages + Workers + D1/Hyperdrive** — cheapest at scale and great cron, but SQLite (D1) is a worse fit for this relational domain and the ecosystem is fiddlier for students to contribute to.
- **Keep AT-style on-prem kiosk box + cloud app hybrid** — only needed if you adopt Wi-Fi presence detection (feature 1.3); the on-site agent can be a Raspberry Pi posting to the cloud API.

### Things that don't port to serverless (plan around them)
- AT's Wi-Fi presence scanning (needs LAN access — on-site agent if wanted).
- CM's inbound SMTP server (use Resend/Postmark inbound webhooks instead, as GP does).
- CH's Twilio webhook works fine as a serverless route.

---

## Appendix: per-source one-liners

- **GatherPack** — the feature superset; steal its domain model (Person/Team tree/Membership, periods+punches, events+checkins) and its feature-toggle discipline. MIT.
- **AdvantageTrack** — the best kiosk UX thinking (presence detection, offline resilience, status lights); Google-Sheets-as-DB is a dead end for us but sheet *export* is a good idea. MIT.
- **RAR tracking** — your own team's scaffold; its stack choices (RR7/Express/Drizzle/Better Auth/RBAC schema) are directly reusable decisions even though features are unbuilt. No license (but it's your team's repo).
- **cheesy-hours** — the deepest attendance *policy* thinking: required vs optional days, excusals, mentor-only sign-out, suspect-session review, semester math. No license — ideas only.
- **cheesy-mail** — permission-gated announcement mail done the hard way; we want the feature via an email API, not an SMTP daemon. No license — ideas only.
- **cheesy-parts** — the whole parts domain: numbering scheme, status pipeline, kanban dashboard, vendor-order auto-grouping, reimbursement tracking. BSD-2.
- **Den (Tiger Dynasty)** — closed-source but the most modern feature set: inventory + storage boxes, purchase-request approvals with URL auto-fill, 3D print queue, Google-Calendar-anchored attendance with the best forgotten-clock-out policy, task boards with dependency-aware Gantt, guest mode. Recreate from observed behavior ([sources/den.md](sources/den.md)); its stack (React SPA + Node/Express) is also the closest cousin to ours.

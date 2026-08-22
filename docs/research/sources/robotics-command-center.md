# Robotics Command Center — Source Survey

**Repo:** staheliemily/robotics-command-center — https://github.com/staheliemily/robotics-command-center
**Surveyed-at:** 9204c6a77de701fcb6bbf885a819d28d50c1d51e
**Permalink form:** https://github.com/staheliemily/robotics-command-center/blob/9204c6a77de701fcb6bbf885a819d28d50c1d51e/<path>
**Stack:** React 19 + Create React App (react-scripts 5), React Router v7, TanStack Query v5 for data fetching/caching, Tailwind CSS + Radix UI primitives (dialog/dropdown/popover/select/switch) for the component kit (shadcn-style `src/components/ui/*`), Recharts for charts, Firebase (Auth + Firestore) as the backend — with a full localStorage fallback client that runs the app in a "demo mode" when Firebase env vars aren't set. Deploy config present for Firebase Hosting (`firebase.json`, `.firebaserc`).
**License:** none — no LICENSE file in the tree, `license` field on the GitHub API is `null`, README is the unmodified Create React App boilerplate with no license section. Treat as all-rights-reserved; ideas only, do not copy code.
**Last activity:** 2026-02-13 (pushed_at), single-commit-history-looking small hobby/demo project (294 KB repo size).
**FRC team:** Not tied to a specific real FRC/FTC team — seed/demo data references fictional team names ("Unhatched Plan", "Weight on Our Shoulders" for FTC; "Icarus Innovated", "New Hawks" for FRC), suggesting this is a generic template/demo app rather than one team's production tool.
**Areas:** people/rosters (task assignment by team/department/subsystem, mentor-task board), parts ordering/POs (wishlist-as-procurement-pipeline with cost tracking), communication (admin-editable announcement banner). No time/attendance or part-design/manufacturing-tracking features found; no third-party integrations beyond Firebase/Google itself.

## Purpose
A single-page dashboard template for a program running multiple FTC and FRC teams side by side, giving mentors/admins one place to track cross-team build tasks (Gantt + list view, with milestones), a mentor-specific task/chore board, a team wishlist/procurement pipeline, sponsor and expense tracking with a budget rollup, and lightweight analytics — with a two-role (admin/viewer) permission model and a Google/email auth login screen.

## Auth & Roles
Firebase Auth (email/password + Google OAuth via `signInWithPopup`) wrapped in `src/context/AuthContext.jsx`. On first sign-in a Firestore `users/{uid}` document is auto-created with a default `role: 'viewer'`; role is read back on every auth-state change and exposed as `isAdmin` / `role` in context. Route-level enforcement is only "authenticated vs not" (`ProtectedRoute`/`PublicRoute` in `src/App.jsx`) — there is no per-route or per-collection admin check; `isAdmin` merely toggles whether Edit/Delete/Add buttons render in the UI (client-side only, no Firestore security rules included in the repo). Notably, when Firebase isn't configured (no env vars) the whole app runs in a **demo mode**: any email/password "logs in" as a hardcoded `DEMO_USER` with `role: 'admin'`, and there's a one-click admin/viewer toggle button in the dashboard header (`toggleAdminMode` in `src/pages/Dashboard.jsx`) that simply flips the demo user's role in localStorage — useful for showcasing the two-role UI but obviously not a real access-control boundary.

## Data Model
No SQL/Prisma schema — instead a lightweight, self-documenting JSON entity-schema convention under `src/entities/*.json` (name, fields, types incl. `enum`/`date`/`boolean`, required flags, defaults), paired with a generic Firestore/localStorage CRUD client (`src/api/firestoreClient.js`) that treats every entity as a flat Firestore collection (or a `localStorage` array keyed `robotics_team_{collection}` when Firebase isn't configured). Defined entities/collections:
- `Task` (`src/entities/Task.json`) — title, description, `team` enum (Build/Programming/Outreach/All Teams — generic labels, though the seed data actually uses real team names + `category` FTC/FRC + `department` Mechanical/Electrical/Software/Marketing/Operations), `subsystem` free text, `assigned_to`, `start_date`/`due_date`, `status` enum (Not Started/In Progress/Blocked/Completed), `priority` enum (Low/Medium/High/Critical), `needs_mentor` boolean.
- `Expense` (`src/entities/Expense.json`) — description, amount, `category` enum (Parts/Tools/Registration/Travel/Marketing/Other), team, date, receipt_url.
- `Sponsor` (`src/entities/Sponsor.json`) — name, amount, contact_email, `status` enum (Pending/Confirmed/Received), date_received, notes.
- `Settings` (`src/entities/Settings.json`) — generic key/value store (defaults include `total_budget` and `banner_message`).
- `mentor_tasks` collection (no JSON schema file, inferred from `src/hooks/useMentorTasks.js` and `src/pages/MentorTasks.jsx`) — title, description, `category` enum (Training & Teaching/Technical Support/Fundraising & Sponsors/Administrative/Event Planning/Communication/Logistics), `status` (To Do/In Progress/Waiting/Done), `priority` (Low/Medium/High/Urgent), assigned_to, due_date, notes.
- `wishlist` collection (no JSON schema file, inferred from `src/hooks/useWishlist.js` and `src/pages/Wishlist.jsx`) — name, description, `section` enum (Parts & Hardware/Electronics/Tools & Equipment/Software & Tech/Business & Marketing/Safety & Workspace/Competition & Travel), `status` (Wanted/Ordered/Shipped/Received), `priority`, `estimated_cost`, `link`, notes.
- `Milestone` (inferred from `src/components/milestones/AddMilestoneModal.jsx` and Gantt components) — used as a marker row in the Gantt chart, category-scoped (FTC/FRC).
Every collection is created lazily — there is no migration system; `firestoreClient.initializeSampleData()` seeds demo tasks/sponsors/expenses/settings into localStorage on first load when running without Firebase.

## Features

**People/rosters**
- Task board scoped by team (FTC/FRC category → named team), department, and subsystem, with assignee, priority, status, and a `needs_mentor` flag surfaced as its own "Needs Mentor" risk-alert panel (`src/pages/TaskTracking.jsx`, `src/entities/Task.json`, `src/hooks/useTasks.js`)
- Per-team dashboard cards on the home screen grouped into an "FTC Teams" and "FRC Teams" section (`src/components/dashboard/TeamCard.jsx`, `src/components/dashboard/CategorySection.jsx`, `src/pages/Dashboard.jsx`)
- Task filtering by team/category/status/priority/department (`src/components/tasks/TaskFilters.jsx`)
- Task detail modal and add/edit modal with full field set (`src/components/tasks/TaskDetailModal.jsx`, `src/components/tasks/AddTaskModal.jsx`)
- Gantt-chart view of tasks with milestone rows, category filtering, click-to-add-task-from-timeline, and a dedicated full-screen Gantt mode (`src/components/gantt/GanttChart.jsx`, `src/components/gantt/GanttRow.jsx`, `src/components/gantt/GanttTimeline.jsx`, `src/pages/TaskTracking.jsx`)
- Separate mentor-task board with its own 7-category taxonomy (Training & Teaching, Technical Support, Fundraising & Sponsors, Administrative, Event Planning, Communication, Logistics), status/priority tracking, and category-grouped card layout with per-category stats (`src/pages/MentorTasks.jsx`, `src/hooks/useMentorTasks.js`, `src/components/mentor/AddMentorTaskModal.jsx`)
- Two-role viewer/admin model gating all create/edit/delete affordances app-wide (`src/context/AuthContext.jsx`)

**Parts ordering/POs**
- Team wishlist organized into 7 procurement-pipeline sections (Parts & Hardware, Electronics, Tools & Equipment, Software & Tech, Business & Marketing, Safety & Workspace, Competition & Travel) each with its own icon/color and description (`src/pages/Wishlist.jsx`)
- Per-item status pipeline Wanted → Ordered → Shipped → Received, with per-item estimated cost, external purchase link, priority, and notes (`src/pages/Wishlist.jsx`, `src/components/wishlist/AddWishlistModal.jsx`)
- Aggregate stats: total items by status, and "Est. Remaining" total cost across everything not yet Received (`src/pages/Wishlist.jsx`)
- Per-section cost rollups and wanted/in-progress counts shown on section tile before drilling in (`src/pages/Wishlist.jsx`)
- Sponsor tracking with pending/confirmed/received status and amount (`src/components/finance/SponsorGrid.jsx`, `src/entities/Sponsor.json`)
- Expense logging by category with a running total against a settings-configurable total budget, plus a budget-overview grid (`src/components/finance/ExpenseList.jsx`, `src/components/finance/BudgetGrid.jsx`, `src/components/finance/AddExpenseModal.jsx`, `src/entities/Expense.json`)
- Reports page: financial summary (total income/expenses/net balance/pending sponsors), task-status pie chart, task-priority bar chart, per-team completion comparison bar chart, FTC-vs-FRC category pie chart (`src/pages/Reports.jsx`, using Recharts)

**Communication**
- Admin-editable, dashboard-wide announcement banner ("Click edit to add an announcement") stored as a `Settings` key/value pair, with inline edit/save/cancel UI (`src/pages/Dashboard.jsx` `AnnouncementBanner`, `src/hooks/useSettings.js`)

## Integrations
Firebase only (Auth — email/password + Google OAuth popup; Firestore as the database). No Slack/Discord/TBA/Onshape/SMS/email-sending integrations found.

## Notable Implementation Details
- The whole data layer is one small generic CRUD module (`src/api/firestoreClient.js`) that transparently switches between real Firestore calls and a localStorage-backed clone of the same interface (get/create/update/remove/query/getSetting/setSetting), selected by whether `isFirebaseConfigured()` passes — a clean, low-effort pattern for shipping a fully-functional demo/offline mode without maintaining two codepaths in the UI layer. Worth stealing as a pattern for any tool that wants a "try it without setting up a backend" mode.
- The `Task`/`Expense` entity JSON files (`src/entities/*.json`) are a nice lightweight schema-as-data convention — enum values, required flags, and defaults are declared once and could drive both form generation and validation, though in this codebase they're actually only used as documentation (the modals hardcode their own field lists rather than reading these files at runtime).
- Auth/role separation is UI-only: there are no Firestore security rules in the repo and no server-side role check, so the `isAdmin` gate is purely cosmetic in the shipped code — a re-implementer needs to add real rules/RLS-equivalent enforcement, this repo does not model it.
- Team names are configured as hardcoded arrays (`FTC_TEAMS`/`FRC_TEAMS` in `src/pages/Dashboard.jsx`) rather than a `Team` entity/collection — adding or renaming a team requires a code change, not an admin UI action.
- Wishlist and mentor-task categories/sections are also hardcoded taxonomy objects in the page components (`sectionConfig` in `Wishlist.jsx`, `categoryConfig` in `MentorTasks.jsx`) rather than data-driven, so the section list can't be edited at runtime.
- Uses TanStack Query for all data hooks (`src/hooks/use*.js`) with 1-minute `staleTime` and `refetchOnWindowFocus: false` — a reasonable low-traffic caching default for a small-team internal tool.

## Verdict
Thin but relevant demo/template app rather than a battle-tested team tool — the procurement-pipeline wishlist (7-section taxonomy with cost rollups and status stages) and the "demo mode via localStorage fallback" pattern are the two ideas worth borrowing; the auth/role model is cosmetic only and the rest (task board, Gantt, sponsor/expense tracking, reports) largely duplicates patterns already covered more deeply by other surveyed sources. No license file: ideas only, do not copy code.

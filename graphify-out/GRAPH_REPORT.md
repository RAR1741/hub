# Graph Report - hub  (2026-08-17)

## Corpus Check
- 329 files · ~222,342 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1315 nodes · 2991 edges · 93 communities (63 shown, 30 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- E2E Test Suite
- Admin API Routes
- Time Sheet Import
- Teams Management
- Person Email Identities
- People Import & CRUD
- Admin Dashboard Pages
- Duplicate People Merge
- CI/CD & Feature Docs
- CSV Import Plans
- Account Requests
- Auth & OAuth Setup
- UI Component Library
- Hours & Session Flags
- TypeScript Type Refs
- People & Sessions Pages
- DB Backup to Drive
- Application CSV Parser
- Application Import Runner
- Calendar & Attendance
- Leaderboard & Profiles
- Google Calendar Sync
- Kiosk Clock In/Out
- Dev Dependencies
- Excusals API
- Kiosk Board UI
- Drive Group Sync UI
- Google Directory API
- Settings & Home
- Session Edit API
- Misc: jose
- Misc: package scripts
- Misc: src app admin reports page
- Misc: src app api admin requests exc
- Misc: src app api whos here route
- Misc: src components recommendedmemb
- Misc: src app api admin calendar syn
- Misc: src app api admin kiosk device
- Misc: src lib application import run
- Misc: src lib application import run
- Misc: src lib application parse test
- Misc: docs design ui system design s
- Misc: src lib google auth
- Misc: docs research 00 plan research
- Misc: src components themetoggle
- Misc: src lib reports export
- Misc: src app api admin teams id mem
- Misc: src app layout
- Misc: docs superpowers plans 2026 08
- Misc: src components applicationimpo
- Misc: src components attendancegrida
- Misc: src components meetingform
- Misc: src components recommendedmemb
- Misc:  github workflows db backup ym
- Misc: docs research 01 feature catal
- Misc: package
- Misc: scripts dev up
- Misc: src components periodform
- Misc: src lib csv
- Misc:  devcontainer docker compose y
- Misc: claude hooks session start
- Misc: dev
- Misc: docs research 01 feature catal
- Misc: e2e global setup
- Misc: docs plans 2026 08 16 db backu
- Misc: docs research 01 feature catal
- Misc: eslint config
- Misc: eslint config next
- Misc: next config
- Misc: package devdependencies tailwi
- Misc: package devdependencies types 
- Misc: package devdependencies types 
- Misc: docs plans 2026 08 15 kiosk se
- Misc: docs plans 2026 08 15 kiosk se
- Misc: docs plans 2026 08 15 kiosk se
- Misc: docs research sources advantag
- Misc: docs research sources cheesy h
- Misc: docs research sources cheesy p
- Misc: docs research sources gatherpa
- Misc: docs research sources gatherpa
- Misc: docs research sources rar trac
- Misc: docs setup db backup session p
- Misc: docs setup deploy service role
- Misc: public file svg file icon
- Misc: public globe svg globe icon
- Misc: public next svg nextjs logo
- Misc: public vercel svg vercel logo
- Misc: public window svg window icon

## God Nodes (most connected - your core abstractions)
1. `getViewer()` - 72 edges
2. `hasRole()` - 62 edges
3. `withRole()` - 40 edges
4. `reqString()` - 39 edges
5. `getActivePeriod()` - 31 edges
6. `displayName()` - 25 edges
7. `listPeople()` - 23 edges
8. `runApplicationImport()` - 18 edges
9. `getSetting()` - 18 edges
10. `parseApplications()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Playwright E2E Smoke Suite` --conceptually_related_to--> `CI E2E Job (Playwright)`  [INFERRED]
  docs/plans/2026-08-11-m4-calendar-policy-ship.md → .github/workflows/ci.yml
- `Nightly DB Backup Workflow` --conceptually_related_to--> `Team Hub Application`  [INFERRED]
  .github/workflows/db-backup.yml → README.md
- `close_stale_sessions() (nightly session sweep function)` --references--> `session (attendance record)`  [INFERRED]
  supabase/README.md → docs/specs/2026-08-10-v1-design.md
- `close_stale_sessions() (nightly session sweep function)` --references--> `pg_cron scheduled jobs`  [INFERRED]
  supabase/README.md → docs/specs/2026-08-10-v1-design.md
- `gcal-hourly-sync (pg_cron job calling calendar sync endpoint)` --references--> `pg_cron scheduled jobs`  [INFERRED]
  supabase/README.md → docs/specs/2026-08-10-v1-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Team Hub v1 Sequential Milestone Delivery** — docs_plans_2026_08_10_m1_foundation_auth_m1, docs_plans_2026_08_10_m2_roster_teams_m2, docs_plans_2026_08_11_m3_attendance_core_m3, docs_plans_2026_08_11_m4_calendar_policy_ship_m4 [EXTRACTED 1.00]
- **Team Hub Authentication System** — docs_plans_2026_08_10_m1_foundation_auth_getviewer, docs_plans_2026_08_10_m1_foundation_auth_student_session_jwt, docs_plans_2026_08_10_m1_foundation_auth_oauth_link, docs_plans_2026_08_10_m1_foundation_auth_withrole [INFERRED 0.95]
- **Team Hub Design System Components** — docs_design_ui_system_tailwind_v4_css_first, docs_design_ui_system_theme_tokens, docs_design_ui_system_pit_board, docs_design_ui_system_hazard_stripe [EXTRACTED 1.00]
- **Google API Integration Family** — docs_plans_2026_08_15_drive_group_sync_google_auth_shared, docs_plans_2026_08_15_drive_group_sync_google_directory_client, docs_plans_2026_08_16_db_backup_to_drive_drive_backup_client, docs_setup_google_calendar_google_calendar_setup [INFERRED 0.85]
- **CSV Importer Family (shared tokenizer + pattern)** — docs_plans_2026_08_13_time_sheet_import_csv_tokenizer, docs_plans_2026_08_13_time_sheet_import_parse_time_sheet, docs_plans_2026_08_14_application_import_application_parse, docs_plans_2026_08_13_time_sheet_import_run_time_import [EXTRACTED 0.95]
- **Person Identity Extension Tables** — docs_plans_2026_08_15_multi_email_identities_person_identity_table, docs_plans_2026_08_16_merge_duplicate_people_person_name_alias, docs_plans_2026_08_14_application_import_guardian_model, docs_plans_2026_08_14_application_import_first_experience_model [INFERRED 0.75]
- **Duplicate Pair Rejection Flow** — docs_superpowers_plans_2026_08_17_reject_duplicate_pair_person_merge_rejection, docs_superpowers_plans_2026_08_17_reject_duplicate_pair_reject_pair, docs_superpowers_plans_2026_08_17_reject_duplicate_pair_unreject_pair, docs_superpowers_plans_2026_08_17_reject_duplicate_pair_list_rejected_pairs, docs_superpowers_plans_2026_08_17_reject_duplicate_pair_duplicate_people_component [EXTRACTED 0.95]
- **Recommended Members Feature** — docs_superpowers_plans_2026_08_16_recommended_team_members_compute_add_recommendations, docs_superpowers_plans_2026_08_16_recommended_team_members_recommended_members_component, docs_superpowers_specs_2026_08_16_recommended_team_members_design_membership_filter_rationale [EXTRACTED 0.90]
- **v1 Core Data Model** — docs_specs_2026_08_10_v1_design_person_entity, docs_specs_2026_08_10_v1_design_session_entity, docs_specs_2026_08_10_v1_design_build_day_entity, docs_specs_2026_08_10_v1_design_period_entity, docs_specs_2026_08_10_v1_design_team_entity [EXTRACTED 0.95]

## Communities (93 total, 30 thin omitted)

### Community 0 - "E2E Test Suite"
Cohesion: 0.05
Nodes (43): CSV, authHeaders(), deleteExcusal(), deleteExcusalRequests(), deletePersonByName(), excusalExists(), findPendingExcusalRequestId(), restBaseUrl() (+35 more)

### Community 1 - "Admin API Routes"
Cohesion: 0.06
Nodes (52): Ctx, DELETE, PATCH, POST, Ctx, DELETE, PATCH, POST (+44 more)

### Community 2 - "Time Sheet Import"
Cohesion: 0.06
Nodes (50): POST, DOW, PeriodOpt, TimeImportForm(), doPreview(), onFile(), resetPreview(), withDow() (+42 more)

### Community 3 - "Teams Management"
Cohesion: 0.07
Nodes (39): AdminTeamPage(), AdminTeamsPage(), Ctx, DELETE, PATCH, POST, Ctx, POST (+31 more)

### Community 4 - "Person Email Identities"
Cohesion: 0.07
Nodes (33): Ctx, POST, Ctx, DELETE, Ctx, POST, Ctx, DELETE (+25 more)

### Community 5 - "People Import & CRUD"
Cohesion: 0.06
Nodes (34): Ctx, DELETE, PATCH, GET, importRow(), ImportSummary, POST, RowResult (+26 more)

### Community 6 - "Admin Dashboard Pages"
Cohesion: 0.12
Nodes (22): AdminApplicationImportPage(), AdminBuildDaysPage(), AdminKioskDevicesPage(), AdminMeetingsPage(), AdminEditPersonPage(), AdminPeopleImportPage(), AdminPeriodsPage(), AdminTimeImportPage() (+14 more)

### Community 7 - "Duplicate People Merge"
Cohesion: 0.10
Nodes (27): AdminDuplicatePeoplePage(), GET, POST, DELETE, parseIds(), POST, defaultWinnerId(), DismissedPairs() (+19 more)

### Community 8 - "CI/CD & Feature Docs"
Cohesion: 0.07
Nodes (40): CI Checks Job (lint/typecheck/test), CI Workflow, CI E2E Job (Playwright), SUPABASE_INTERNAL_URL (container-to-sibling), Two Supabase URL Seam, Attendance Periods & Hours Leaderboard, CSV Roster Import, v1 Feature Catalog (+32 more)

### Community 9 - "CSV Import Plans"
Cohesion: 0.06
Nodes (38): parseCsvRecords — Shared CSV Tokenizer, localDateTimeToInstant — Timezone Instant Helper, parseClockToken + resolveColumnTimes — Clock-Time Parsing, parseTimeSheet — Pure Time-Sheet Parser, runTimeImport — Import Runner with Person Matching, Migration: session.source='import' + excusal.source, Time Sheet Import Feature, Student Application Import Feature (+30 more)

### Community 10 - "Account Requests"
Cohesion: 0.10
Nodes (24): AdminHubPage(), IconName, AdminRequestsPage(), Ctx, POST, Ctx, POST, AccountRequestActions() (+16 more)

### Community 11 - "Auth & OAuth Setup"
Cohesion: 0.08
Nodes (34): decideOAuthLink (allowlist function), First-user Admin Bootstrap (OAuth), Google OAuth Client (Cloud Console), Google OAuth Setup Guide, Supabase Auth Callback (OAuth redirect URI), account_request (student onboarding queue), build_day (calendar date with kind), getViewer() (auth normalization helper) (+26 more)

### Community 12 - "UI Component Library"
Cohesion: 0.09
Nodes (17): BuildDayRow(), DeletePeriodButton(), Icon(), IconName, paths, DeviceRow(), KioskDeviceManager(), MeetingRow() (+9 more)

### Community 13 - "Hours & Session Flags"
Cohesion: 0.13
Nodes (18): FlaggedSessionsPage(), FlagKind, overlappingSessionIds(), sessionFlags(), sessionHours(), base, totalHours(), fetchAllRows() (+10 more)

### Community 14 - "TypeScript Type Refs"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 15 - "People & Sessions Pages"
Cohesion: 0.12
Nodes (14): AdminPeoplePage(), initials(), AdminSessionsPage(), DeletePersonButton(), IdentityView, PersonEmails(), EMPTY, PersonForm() (+6 more)

### Community 16 - "DB Backup to Drive"
Cohesion: 0.16
Nodes (18): main(), backupObjectName(), DriveFileMeta, selectBackupsToDelete(), deleteDriveFile(), DRIVE_SCOPE, DriveBackupCredentials, driveBackupCredentialsFromEnv() (+10 more)

### Community 17 - "Application CSV Parser"
Cohesion: 0.14
Nodes (25): ApplicationAnomaly, ApplicationParseResult, buildColumnMap(), buildGuardian(), ColumnMap, dedupeApplications(), extractSeasonYear(), findIndex() (+17 more)

### Community 18 - "Application Import Runner"
Cohesion: 0.16
Nodes (22): POST, appFieldWrites(), ApplicationDecision, ApplicationImportSummary, Candidate, computeChanges(), currentSeasonYear(), decisionKey() (+14 more)

### Community 19 - "Calendar & Attendance"
Cohesion: 0.19
Nodes (16): CalendarPage(), MyAttendancePage(), ExcusalRequestForm(), attendanceForDate(), AttendanceStatus, attendanceSummary, isPresent(), localDateOf() (+8 more)

### Community 20 - "Leaderboard & Profiles"
Cohesion: 0.14
Nodes (16): entryLabel(), LeaderColumn(), PersonPage(), ASSIGNABLE_ROLES, AssignableRole, canViewProfile(), getPersonWithTeams(), publicName() (+8 more)

### Community 21 - "Google Calendar Sync"
Cohesion: 0.13
Nodes (17): buildServiceAccountJwt(), fetchAccessToken(), fetchAllEvents(), GcalCredentials, GcalDeps, GcalEvent, GcalTransport, isRequiredEvent() (+9 more)

### Community 22 - "Kiosk Clock In/Out"
Cohesion: 0.19
Nodes (14): clockLimiter, POST(), clockLimiter, POST(), POST(), setupLimiter, KIOSK_COOKIE, kioskTokenFromRequest() (+6 more)

### Community 23 - "Dev Dependencies"
Cohesion: 0.11
Nodes (19): dotenv, eslint, devDependencies, dotenv, eslint, @playwright/test, supabase, tailwindcss (+11 more)

### Community 24 - "Excusals API"
Cohesion: 0.25
Nodes (13): POST(), DELETE, POST, createExcusal(), deleteExcusal(), ExcusalInput, parseExcusalInput(), optDate() (+5 more)

### Community 25 - "Kiosk Board UI"
Cohesion: 0.16
Nodes (12): Here, KioskBoard(), call(), onSearchKeyDown(), KioskSetupForm(), Member, Entry, WhosHere() (+4 more)

### Community 26 - "Drive Group Sync UI"
Cohesion: 0.15
Nodes (11): AdminDriveSyncPage(), expectedCount(), IdentityJoin, MembershipPersonRow, DriveSyncPanel(), SyncOutcome, AssociateModal(), PickPerson (+3 more)

### Community 27 - "Google Directory API"
Cohesion: 0.21
Nodes (13): syncMembershipChange(), deleteGroupMember(), DIRECTORY_SCOPE, DirectoryDeps, fetchAccessToken(), insertGroupMember(), listGroupMembers(), membersUrl() (+5 more)

### Community 28 - "Settings & Home"
Cohesion: 0.20
Nodes (7): AdminSettingsPage(), HomePage(), SettingsForm(), SettingsValues, hoursGoalProgress, personPeriodHours(), getSetting()

### Community 29 - "Session Edit API"
Cohesion: 0.24
Nodes (12): Ctx, DELETE, PATCH, POST, createManualSession(), deleteSession(), isoOrNull(), ManualSession (+4 more)

### Community 30 - "Misc: jose"
Cohesion: 0.13
Nodes (15): jose, next, dependencies, jose, next, react, react-dom, server-only (+7 more)

### Community 31 - "Misc: package scripts"
Cohesion: 0.13
Nodes (15): scripts, backup:db, build, db:psql, db:reset, //db-scripts, db:start, db:stop (+7 more)

### Community 32 - "Misc: src app admin reports page"
Cohesion: 0.35
Nodes (11): AdminReportsPage(), GET, GET, LeaderboardPage(), attendanceSummaryForPeriod(), getActivePeriod(), getPeriod(), listPeriods() (+3 more)

### Community 33 - "Misc: src app api admin requests exc"
Cohesion: 0.22
Nodes (10): Ctx, POST, excusalRequestLimiter, POST(), createExcusalRequest(), ExcusalRequestInput, parseExcusalRequestInput(), PendingExcusalRequest (+2 more)

### Community 34 - "Misc: src app api whos here route"
Cohesion: 0.25
Nodes (8): GET(), KioskPage(), verifyKioskToken(), activeMembersForKiosk(), ClockResult, KioskMember, listWhosHere(), WhosHereEntry

### Community 35 - "Misc: src components recommendedmemb"
Cohesion: 0.16
Nodes (10): RowState, AddRecommendation, computeGroupDiff(), GroupReconcileReport, LinkedTeamRow, TeamAddRecommendations, credentials, PEM (+2 more)

### Community 36 - "Misc: src app api admin calendar syn"
Cohesion: 0.29
Nodes (9): POST(), POST(), POST, getDb(), reconcileDriveGroups(), gcalCredentialsFromEnv(), pickCalendarId(), directoryCredentialsFromEnv() (+1 more)

### Community 37 - "Misc: src app api admin kiosk device"
Cohesion: 0.26
Nodes (9): Ctx, DELETE, PATCH, POST, createKioskDevice(), deleteKioskDevice(), generateKioskToken(), hashKioskToken() (+1 more)

### Community 38 - "Misc: src lib application import run"
Cohesion: 0.35
Nodes (9): matchApplicant(), DupCandidate, DupPerson, findDuplicateCandidates(), isPrefixMatch(), levenshtein(), nameKey(), nameSimilarity() (+1 more)

### Community 39 - "Misc: src lib application import run"
Cohesion: 0.18
Nodes (8): AliasSeed, fakeDb(), guardianBuilder(), makeUpdateChain(), personBuilder(), GuardianSeed, IdentitySeed, PersonSeed

### Community 40 - "Misc: src lib application parse test"
Cohesion: 0.29
Nodes (10): buildCsv(), buildDupCsv(), csvField(), csvRow(), HEADER_2022, HEADER_2023, HEADER_2024, HEADER_2025 (+2 more)

### Community 41 - "Misc: docs design ui system design s"
Cohesion: 0.24
Nodes (10): UI Design System, Hazard Stripe (.hazard) Accent, Pit Board Component (.pit/.pit-row), Shop-Floor Control Panel Visual Theme, Tailwind CSS v4 (CSS-first, no config file), Theme Token System (light/dark/system), Tailwind UI Restyle Plan, Icon Component (inline SVG set) (+2 more)

### Community 42 - "Misc: src lib google auth"
Cohesion: 0.31
Nodes (7): base64url(), buildServiceAccountJwt(), fetchGoogleAccessToken(), GoogleSaCreds, CREDS, PEM, { privateKey }

### Community 43 - "Misc: docs research 00 plan research"
Cohesion: 0.22
Nodes (9): Team Hub Research & Build Plan, Team Hub Feature Catalog, AdvantageTrack (FRC 6328) — Attendance System, cheesy-hours (FRC 254) — Hours Tracking App, cheesy-mail (FRC 254) — SMTP Mailing List Daemon, cheesy-parts (FRC 254) — Part Tracking System, Tiger Den (FRC 5010) — Team Management SPA, GatherPack — Rails Team Management App (+1 more)

### Community 44 - "Misc: src components themetoggle"
Cohesion: 0.36
Nodes (8): getServerSnapshot(), getSnapshot(), listeners, setTheme(), subscribe(), systemTheme(), Theme, ThemeToggle()

### Community 45 - "Misc: src lib reports export"
Cohesion: 0.39
Nodes (7): attendanceSummaryCsv(), AttendanceSummaryCsvRow, csvField(), hoursReportCsv(), HoursReportCsvRow, toCsv(), RFC-4180

### Community 46 - "Misc: src app api admin teams id mem"
Cohesion: 0.47
Nodes (5): Ctx, DELETE, POST, removeMember(), upsertMember()

### Community 47 - "Misc: src app layout"
Cohesion: 0.33
Nodes (4): archivo, inter, jetbrainsMono, metadata

### Community 48 - "Misc: docs superpowers plans 2026 08"
Cohesion: 0.70
Nodes (5): computeAddRecommendations() (pure recommendation function), RecommendedMembers (client component), Recommended Team Members Implementation Plan, Load-bearing membership filter (not a staleness guard), Recommended Team Members Design Spec

### Community 49 - "Misc: src components applicationimpo"
Cohesion: 0.50
Nodes (3): ApplicationImportForm(), onFile(), resetPreview()

### Community 51 - "Misc: src components meetingform"
Cohesion: 0.40
Nodes (3): EMPTY, MeetingForm(), MeetingFormValues

### Community 52 - "Misc: src components recommendedmemb"
Cohesion: 0.70
Nodes (5): RecommendedMembers(), addAll(), addOne(), addOneAndRefresh(), keyFor()

### Community 53 - "Misc:  github workflows db backup ym"
Cohesion: 0.67
Nodes (4): Nightly DB Backup Workflow, FRC Team 1741 Red Alert Robotics, Team Hub README, Team Hub Application

### Community 54 - "Misc: docs research 01 feature catal"
Cohesion: 0.67
Nodes (4): Attendance / Hours Tracking Feature Area, Attendance Calendar Grid (Required/Optional/Excused), Google Calendar Anchored Attendance, Midnight Auto-Close Backdated to Meeting End

### Community 55 - "Misc: package"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 56 - "Misc: scripts dev up"
Cohesion: 0.83
Nodes (3): log(), dev-up.sh script, shutdown()

### Community 59 - "Misc:  devcontainer docker compose y"
Cohesion: 0.67
Nodes (3): Dev Container App Service, Docker-outside-of-Docker Pattern, Root Docker Compose Stack

### Community 62 - "Misc: docs research 01 feature catal"
Cohesion: 0.67
Nodes (3): Roster / Membership Feature Area, Guest Read-Only Mode (Server-Enforced), Person Model (GatherPack Hub Entity)

## Knowledge Gaps
- **319 isolated node(s):** `CSV`, `ROUTES`, `SEEDED_MENTOR_ID`, `SEEDED_ADMIN_ID`, `HASH` (+314 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getViewer()` connect `Admin Dashboard Pages` to `Misc: src app admin reports page`, `Misc: src app api admin requests exc`, `Misc: src app api whos here route`, `Teams Management`, `Misc: src app api admin calendar syn`, `E2E Test Suite`, `Duplicate People Merge`, `Account Requests`, `Hours & Session Flags`, `People & Sessions Pages`, `Calendar & Attendance`, `Leaderboard & Profiles`, `Drive Group Sync UI`, `Settings & Home`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `withRole()` connect `Person Email Identities` to `Misc: src app admin reports page`, `Admin API Routes`, `Misc: src app api admin requests exc`, `Teams Management`, `Misc: src app api admin calendar syn`, `Misc: src app api admin kiosk device`, `People Import & CRUD`, `Duplicate People Merge`, `Time Sheet Import`, `Admin Dashboard Pages`, `Account Requests`, `Misc: src app api admin teams id mem`, `Application Import Runner`, `Excusals API`, `Session Edit API`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `hasRole()` connect `Admin Dashboard Pages` to `Misc: src app admin reports page`, `Teams Management`, `Misc: src app api admin calendar syn`, `Person Email Identities`, `Duplicate People Merge`, `Account Requests`, `Hours & Session Flags`, `People & Sessions Pages`, `Calendar & Attendance`, `Leaderboard & Profiles`, `Drive Group Sync UI`, `Settings & Home`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `CSV`, `ROUTES`, `SEEDED_MENTOR_ID` to the rest of the system?**
  _319 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `E2E Test Suite` be split into smaller, more focused modules?**
  _Cohesion score 0.05365686944634313 - nodes in this community are weakly interconnected._
- **Should `Admin API Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.05803571428571429 - nodes in this community are weakly interconnected._
- **Should `Time Sheet Import` be split into smaller, more focused modules?**
  _Cohesion score 0.060814383923849816 - nodes in this community are weakly interconnected._
# FRC-TimeTracker — Source Survey

**Repo:** gbeford/frc-timetracker — https://github.com/gbeford/FRC-TimeTracker
**Surveyed-at:** ad7f1e1f946f1d2dd6dc32467a64aff4622119dd
**Permalink form:** https://github.com/gbeford/FRC-TimeTracker/blob/ad7f1e1f946f1d2dd6dc32467a64aff4622119dd/<path>
**Stack:** Angular 8 (TypeScript) SPA + Angular Material/CDK + Bootstrap 4; talks to an external REST API (`environment.baseUrl`, default `http://localhost:5000/`) that is not in this repo — no backend/DB code present, only the client. `firebase.json`/`.firebaserc` exist but only for static hosting of the built SPA, no Firestore/Auth SDK in `package.json`.
**License:** ambiguous — `package.json` declares `"license": "MIT"` but the repository has **no LICENSE file**, and the GitHub API reports `license: null` (GitHub could not detect one). Per ground rules, treat as ambiguous/no-file — ideas only, do not copy code or assume MIT applies.
**Last activity:** 2023-01-03 (single commit history reachable; repo appears to be a squashed/imported history)
**FRC team:** unknown (no team number in README, code, or asset names; "Guertin" report name suggests a mentor/coach surname, not a team number)
**Areas:** (1) time/attendance — primary focus; (2) people/rosters — student roster with grade/email; (5) parts ordering/POs — NOT applicable to hardware parts, but the app implements a full internal "apparel store" ordering/checkout/payment-tracking flow that is directly analogous to a PO/ordering workflow and worth reviewing under that lens.

## Purpose
A kiosk-style sign-in/sign-out time & points tracker for FRC students, paired with an internal team-apparel storefront (browse, cart, checkout, order/payment tracking) and admin tooling for managing students, badges, messages, and attendance events. Built as an Angular SPA against a separate REST backend (not included in this repo).

## Auth & Roles
- Custom bearer-token auth: `SecurityService.login()` POSTs credentials to `api/security/login_user`, stores an `AppUserAuth` object (`bearerToken`, `isAuthenticated`, `claims[]`) in `sessionStorage` (`src/app/security/security.service.ts`).
- `HttpRequestInterceptor` (`src/app/security/http-interceptor.ts`) reads the token from `sessionStorage` and attaches `Authorization: Bearer <token>` to every outgoing HTTP request.
- Claims-based authorization, ASP.NET-style: `AppUserClaim { claimType, claimValue }`. `SecurityService.hasClaim()` supports `'claimType'` (implies `value=true`), `'claimType:value'`, and arrays of claim strings (`src/app/security/security.service.ts`).
- Route guarding: `AuthGuard` (`src/app/security/auth.guard.ts`) reads a `data['claim']` array off the route config and calls `hasClaim`, redirecting to `/` with a `returnUrl` query param on failure.
- Template-level authorization: a structural directive `*hasClaim="'claimType:value'"` (`src/app/security/has-claim.directive.ts`) shows/hides DOM based on the same claim check — lets admin-only buttons/menus be hidden without duplicating guard logic.
- No client-side password hashing/roles beyond claims; all authorization logic assumes a trusted external API for actual enforcement (the client-side guard is UX-only, not a security boundary).

## Data Model
Client-side interfaces/classes only (backend schema not in repo):
- `Student` (`src/app/model/student.ts`): id, studentId, firstName, lastName, email, grade, created/updated timestamps, `signInTime`, `isSignedIn` flag, `messages: string[]`, `eventID`.
- `ITimeTracker` (`src/app/model/time-tracker.ts`): studentId, createDate/createDateTime, inTime, outTime, totalHrs, points, adminSignedOut flag — one row per sign-in/out session.
- `IEvent` (`src/app/model/event.ts`): eventID, description, show (visibility toggle), sortOrder — the "reason for attendance" dropdown (meeting, competition, etc.) shown at sign-in.
- `IPoints` (`src/app/model/points.ts`): eventId, Description, Points, SortOrder, Show — a point-value table keyed similarly to events, feeding a student rewards/points system.
- `IMessage` (`src/app/model/message.ts`): messageID, messageText — canned messages attachable to a student (e.g., "see mentor before leaving").
- `User` (`src/app/model/user.ts`): id, displayName, email, password, dateTime, role.
- `AppUserClaim`/`AppUser`/`AppUserAuth` (`src/app/security/`): claims-based auth objects.
- Apparel domain: `IApparel` (apparel-model.ts), `IApparelImage`, `ITeamUniform` (teamUniform.ts: apparelID, item, description, price, gender, size, type, quantity), `CartItem`/`ShoppingCart` (cart-Item.ts, shopping-cart-model.ts), `IOrder`/`IOrderDetails` (order-model.ts, order-details.model.ts).

## Features

### Time/attendance
- Kiosk sign-in/out screen (`src/app/time-tracker/time-tracker.component.ts`): student autocomplete search, event-reason dropdown (defaults to a preset event id), single "Sign in / Sign out" button that flips label/state based on `student.isSignedIn`, snackbar toast confirmation ("X signed in." / "X signed out."), and auto-opens a modal (`TimeTrackerMsgComponent`) to display any pending messages attached to the student after sign-in/out.
- Sign-in/out API split by direction: `StudentService.signIn_OutStudent()` posts to `signInStudentUrl/{id}` with the selected event id, or `signOutStudentUrl` with just the student id (`src/app/student/student.service.ts`).
- Bulk "sign out all students still signed in" admin action (`StudentService.logOutStudents()` → `signOutAllStudentsUrl`), useful for end-of-day cleanup if students forget to sign out.
- Attendance events/reasons CRUD (`src/app/events/events.service.ts`, `src/app/events/add-edit-event.component.ts`): create/edit/delete named events with a `show` (active/inactive) flag and manual `sortOrder` for dropdown ordering.
- Points system tied to events (`src/app/model/points.ts`, `src/app/points/add-new-point`, `src/app/points/apply-points-to-student`): admin can define point values per event/action and apply points to a student's record — a reward/gamification layer on top of raw hours.
- Attendance date-range report (`src/app/reports/reports.service.ts` `getStudentAttendance(inDate, outDate)` → `api/Reports/Attendance`) and a per-student hours+points report (`src/app/student/student-time-point-report/student-time-point-report.component.ts`) with CSV export (`angular5-csv` dependency).
- Admin manual record editor (`src/app/admin/edit-student-record/edit-student-record.component.ts`): pick a student via autocomplete, then hand-edit create date, in/out times, total hours, and points for a specific attendance record — a correction/override path for missed sign-outs.
- ID badge generation: `badge-entry` (assign/print) and `badge-view` (`src/app/admin/badge/`) components for looking up a student and generating/viewing a printable badge (badge-view even ships an `original-html.component.htlm` reference template).

### People/roster
- Sortable/filterable student roster table (`src/app/student/student-list/student-list.component.ts`) using `MatTableDataSource` + `MatSort`, columns: studentId, status (signed in/out), lastName, firstName, email, grade, messages.
- Student self sign-up form (`src/app/sign-up-form/sign-up-form.component.ts`).
- Reusable typeahead/autocomplete component (`src/app/shared/auto-complete/auto-complete.component.ts`) used across time-tracker, badges, and admin edit screens for student lookup.
- Per-student message assignment/removal (`StudentService.setMessage()`, `MessageService` CRUD in `src/app/message/message.service.ts`) — canned messages (e.g. reminders, warnings) can be attached to a student and are surfaced automatically at next sign-in/out.

### Internal apparel/parts-ordering analogue (area 5-adjacent)
- Storefront (`src/app/apparel/apparel-store-front/apparel-store-front.component.ts`): browse apparel catalog (`ClothingService.getApparelList()`), pick size/gender/type/quantity, add to a session shopping cart (`ShoppingCartService`), require a student to be selected before checkout.
- Shopping cart model and service (`src/app/apparel/shopping-cart-model.ts`, `shopping-cart.service.ts`, `cart-Item.ts`).
- Checkout flow (`src/app/apparel/checkout/checkout.component.ts`) resolves an order by id from the route and displays it; `order-confirmation` component shows the post-submit confirmation page.
- Order/payment admin reports: `orders-report` (list all orders, mark-paid modal, delete order — `src/app/apparel/orders-report/`, `paid-modal/`), `order-detail-report` (line-item breakdown: item/size/sleeve/quantity/gross total/paid — `order-detail-report.component.ts`), and unpaid-order search by name/order-id/student-id (`OrderService.getUnpaidOrders(searchBy, searchValue)`).
- Apparel catalog admin: add/edit apparel items with size validation (`apparel/add-apparel`, `apparel-card/optional-required-validation.ts`), image upload for product photos (`src/app/apparel/image-upload-form.component.ts`, generic reusable `src/app/shared/image-upload/`), apparel list editor (`apparel-list-edit`).
- A "Guertin report" (`src/app/apparel/guertin-report/guertin-report.component.ts`) — component shell present but effectively empty in this snapshot (no logic beyond `ngOnInit`), likely a custom sponsor/mentor-specific export that was scaffolded but not finished.

## Integrations
None found in dependencies — no Stripe/PayPal SDK despite an order/payment/"mark paid" flow (payment marking appears to be a manual admin action, not a real payment gateway integration), no Slack/Discord/email/SMS/Onshape/TBA. `firebase.json`/`.firebaserc` only configure Firebase Hosting for the compiled static SPA, not any Firebase services (Firestore/Auth/Functions are absent from `package.json` and never imported).

## Notable Implementation Details
- The app is a pure Angular 8 frontend against an undisclosed external REST API; all "backend" behavior (auth issuance, hour calculation, payment marking) lives server-side and out of scope for this repo — only the client contracts (URL paths in `src/environments/environment.ts`, request/response shapes in the `model/` folder) are recoverable.
- Claims-based auth pattern (bearer token + claim-type/value pairs + a structural `*hasClaim` directive + a route-data-driven `AuthGuard`) is a clean, reusable pattern for claim/permission gating in Angular, worth reusing as a design reference even though the code itself is not being copied.
- Attendance correction is handled via a fully manual "edit student record" admin form rather than any automated stale-session detection — a real gap: if a student forgot to sign out, the record apparently just sits until an admin manually retypes in/out times and hours.
- The "sign out all students" bulk action description in `student.service.ts` claims it "set's the student hours to 1" — suggests the backend may zero out or default hours to a placeholder value on forced bulk sign-out rather than computing real elapsed time, a likely bug/quirk to avoid replicating.
- Uses very old Angular idioms even for its Angular-8 era (rxjs-compat, `rxjs/Observable/of` deep imports, commented-out dead code throughout services) — a sign of an unmaintained/early-stage project; several features (points service file, Guertin report) are stubbed or missing entirely.
- Points and Events share a nearly identical shape (`eventId/Description/Points/SortOrder/Show` vs `eventID/description/show/sortOrder`), suggesting the two were meant to be unified but weren't — a re-implementation should merge "reason for visit" and "point value" into one entity rather than keeping them parallel and inconsistently cased.

## Verdict
Substantive and directly relevant for the time/attendance area (event-tagged sign-in/out, points-per-event gamification, manual correction UI, bulk sign-out, attendance CSV reports) and offers a clean reusable claims-based-auth pattern; the bundled apparel storefront is a good analogue for an internal ordering/payment-tracking UI if the team ever needs one. License is ambiguous (MIT claimed in package.json, no LICENSE file) — ideas only, no code reuse.

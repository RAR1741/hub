# OptixToolkit — Source Survey

**Repo:** https://github.com/Team-Optix-3749/OptixToolkit (FRC 3749, "Optix")
**Surveyed at commit:** `1ecbc750ff82e94178ffe14535af09538e58f1d1` (2024-12-10)
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Team-Optix-3749/OptixToolkit/blob/1ecbc750ff82e94178ffe14535af09538e58f1d1/<path>`

## Purpose

OptixToolkit is a mobile app (Android/iOS via Flutter) built by FRC Team 3749 (Optix) to cover
three of a robotics team's internal-ops needs in one app: shop-tool check-out/reservation,
build-season part ordering + purchase reimbursement, and meeting attendance (time clock). It is a
thin Flutter client only — all business logic and persistence live in a separate backend service
(not in this repo) reached over a single JSON HTTP endpoint. The README frames it as two originally
separate sub-projects ("OptixTools" for tool tracking, "OptixParts" for part ordering) that were
merged into one app; attendance/hours tracking was added later and is the most complete feature at
the surveyed commit. This is an FRC team's internal tool, not an FTC/VEX project.

## Stack

- **Client:** Flutter/Dart (`pubspec.yaml`: SDK `>=2.12.0 <3.0.0`, app version `5.0.0+5`), single
  codebase targeting Android and iOS (`android/`, `ios/`). State/DI via `provider` +
  `FutureProvider`/`StreamProvider`; no routing package — navigation is a raw `Navigator` wrapped
  by a singleton `NavigationService` (`lib/services/NavigationService.dart`).
- **Auth:** Firebase Authentication (`firebase_auth`), email/password. Firebase custom claims
  (`idToken.claims['admin']`) gate admin-only UI, checked ad hoc in each widget rather than via a
  central role service.
- **Backend:** Not in this repo. The client's primary data layer (`lib/services/database.dart`)
  posts every operation as `{"endpoint": "<name>", ...}` JSON to a single fixed URL,
  `Constants.SERVER_URL = "https://toolkit.team3749.org/"` (`lib/constants.dart`), i.e. one
  catch-all POST endpoint dispatching on an `endpoint` field rather than a REST API. A committed
  GitHub Actions cron (`.github/workflows/mongo.yml`) resets `tools.reservations` and
  `tools.status` daily via a `mongo` shell one-liner against a `MONGO` secret — this is the
  strongest evidence for the backend's datastore (MongoDB) since no backend source is checked in.
- **File storage:** Firebase Storage, for reimbursement receipt photos (`lib/services/firebase.dart`
  `Auth.getImageUrl`).
- **Key packages:** `flutter_barcode_scanner`, `barcode_scan2` (two different scanner packages are
  both depended on and both used, in different screens — see Notable Implementation Details),
  `google_fonts`, `image_picker`, `percent_indicator`, `rxdart`, `loading_animations`,
  `permission_handler`, `http`.
- **License:** MIT, Copyright (c) 2020 Team Optix 3749, in `LICENSE`.
- **CI/Distribution:** `.github/workflows/build.yml` builds a release APK on every push
  (`flutter build apk`), tags the commit with a Unix-timestamp tag, and publishes the APK as a
  GitHub Release asset — this is the app's only distribution channel (no Play Store/App Store
  listing evident in-repo).

## Auth & Roles

- **Sign-up / sign-in / password reset** — plain Firebase email+password (`lib/services/firebase.dart`
  `Auth.signUp`/`signIn`/`sendPasswordResetEmail`), UI in `lib/ui/CreateAccount.dart`,
  `lib/ui/Form.dart` (`FormPage`), `lib/ui/ForgetPassword.dart`.
- **Session:** `firebase.FirebaseAuth.instance.authStateChanges()` stream drives a `StreamProvider`
  at the app root (`lib/main.dart`); once signed in, `user.getIdTokenResult()` is fetched into a
  `FutureProvider<IdTokenResult>` so every screen can read the decoded ID-token claims.
- **Roles:** binary — Firebase custom claim `admin: true/false` on the ID token, checked inline as
  `Provider.of<firebase.IdTokenResult>(context).claims?['admin'] == true` in each widget that needs
  it (`lib/ui/tools/ToolReserve.dart`, `ToolReserveItem.dart`, `lib/ui/parts/PartModal.dart`,
  `lib/ui/ProfilePage.dart`). There is no server-side role model in this repo (claims are presumably
  set by the backend); the client only reads them. A separate "certified" boolean exists per user
  (see Data Model) and gates nothing in the client UI observed — it is display-only in `UserModal`.
- **No self-service account deletion in-app**; `ACCOUNT_REMOVAL.md` at repo root instead documents
  how a user requests account/data deletion out-of-band (points to a support email), to satisfy
  Play Store data-safety requirements — there is no in-app delete-my-account flow.

## Data Model

Modeled only as client-side Dart classes deserialized from the backend's JSON responses
(`lib/services/database.dart`); no schema/migrations are in this repo.

- **Part** — `id`, `uid` (creator), `name`, `link`, `trackingId`, `carrier`, `description`,
  `priority` (int), `displayName` (creator's name, server-populated), `status`. Status is computed
  client-side from a raw carrier-tracking status (`pre_transit`/`in_transit`/`out_for_delivery`/
  `delivered`/`return_to_sender`/`failure`/`unknown`) mapped through `deliveryMap` into one of
  `Ordered`/`Shipped`/`Arrived`/`Failure` — implying the backend polls a shipment-tracking API and
  stores its raw status verbatim.
- **Tool** — `id`, `name`, `category` (free-text, e.g. "Drill", "Mill" — see `ToolAdd.dart`'s fixed
  dropdown of suggested categories), `user` (current holder or the literal string `"null"`),
  `status` (`notInUse`/`inUse`/`reserved`/`outOfService`), `reservations` (list of
  `{uid, dName}` maps — a waitlist/reservation queue per tool, not a single reservation).
- **User** — `uid`, `email`, `displayName`, `certified` (bool) — a per-user "certified to use
  tools" flag, settable only by an admin (see Features).
- **Inventory** — a separate, barcode-keyed item type distinct from `Tool`: `name`, `description`,
  `count`, `barcodeId`, `status` (free-text), `location` (free-text) — looked up and edited via
  barcode scan in the tools flow (see Features). Whether `Inventory` and `Tool` are the same backend
  collection is not determinable from the client.
- **LastCheckInTime** / **MeetingCount** — thin wrappers around a raw int (ms-since-epoch check-in
  marker, and a lifetime meeting count) returned by the attendance endpoints.

## Features

- **Email/password sign-up** — Create account with password confirmation and an inline show/hide
  toggle; min-6-char validation. `lib/ui/CreateAccount.dart`, `Auth.signUp`
  (`lib/services/firebase.dart`).
- **Login** — Email/password with a "Forgot password?" link and a "Create account" link.
  `lib/ui/Form.dart` (`FormPage`) — **note:** this screen is unreachable in the surveyed commit; see
  Notable Implementation Details.
- **Forgot password** — Sends a Firebase password-reset email. `lib/ui/ForgetPassword.dart`,
  `Auth.sendPasswordResetEmail`.
- **Bottom-nav shell** — Five tabs: Home, Hours, Tools, Reimbursements, Profile, driven by a single
  `_selectedIndex` in a stateful root widget (no named routes). `lib/ui/Home.dart`
  (`MyStatefulWidget`).
- **Home dashboard** — Greets the user by first name, shows total elapsed logged time
  (`hh:mm:ss`, computed client-side from a raw ms count), and an inline list of tool reservations
  ordered newest-first; tapping the reservations card jumps to the Hours tab. `lib/ui/HomePage.dart`,
  `Database.getParts`/`getToolsReversed`/`getTime`.
- **Meeting check-in (attendance)** — "CHECK IN" button opens a dialog for a one-time code; submits
  to the backend, shows a success toast, and refreshes the page's stats. `lib/ui/HoursPage.dart`
  (`_showMyDialogCheckIn`), `Database.checkIn`.
- **Meeting check-out (attendance)** — Same pattern in reverse, ends the logging session for that
  meeting. `lib/ui/HoursPage.dart` (`_showMyDialogCheckOut`), `Database.checkOut`.
- **Attendance status + stats** — Shows total logged time, a color-coded "Logging"/"Not Logging"
  status derived from whether a last-check-in timestamp is nonzero, and a lifetime "Total Meetings"
  counter. `lib/ui/HoursPage.dart`, `Database.getTime`/`getLastCheckIn`/`getMeetingCount`.
- **Tool list by category** — Tools grouped into category cards (e.g. "Drill", "Mill"), each card
  showing one colored dot per tool indicating its status. `lib/ui/tools/ToolsPage.dart`
  (`toolsPage`/`ToolWidget`), `lib/ui/tools/ToolCard.dart`, `lib/ui/tools/ToolStatus.dart`,
  `Database.getTools`.
- **Tool category detail / reserve or unreserve a tool** — Tapping a category opens its tool list;
  each tool has a RESERVE/UNRESERVE toggle button (adds/removes the current user from that tool's
  reservation queue) based on whether the user's uid is already in `tool.reservations`.
  `lib/ui/tools/ToolReserve.dart`, `lib/ui/tools/ToolReserveItem.dart`, `Database.reserveTool`/
  `reserveToolRemove`.
- **View a tool's reservation queue** — Tapping a tool (short tap) lists everyone currently
  reserved on it, each removable via a tap on a cancel icon next to their name. `ToolReserveItem.dart`
  (`_showMyDialog`), `Database.reserveToolRemove`.
- **Report a tool broken / back in service** — Long-pressing a tool opens a dialog toggling its
  status between `notInUse` and `outOfService` (button label flips between "Tool is Broken" and
  "Tool is Working"); admins additionally see a "Remove" button in the same dialog to delete the
  tool outright. `ToolReserveItem.dart` (`_showToolService`), `Database.changeToolStatus`/
  `removeTool`.
- **Add a tool (admin only)** — Floating "+" button on the tool-reservation screen, visible only
  when the ID token's `admin` claim is true; form with a name field and a fixed category dropdown
  (Drill, Jig Saw, Circular Saw, Drill press, Mill, Chop Saw, Driver, Angle Grinder, Band Saw).
  `lib/ui/tools/ToolReserve.dart`, `lib/ui/tools/ToolAdd.dart`, `Database.addTool`.
- **Barcode scan to look up an inventory item** — "SCAN" button opens the device camera via
  `barcode_scan2`; the scanned code (first/last character stripped, presumably a check-digit or
  wrapper symbol) is looked up against the backend inventory and opens a detail page.
  `lib/ui/tools/ToolsPage.dart` (`_scanBarcode`), `Database.getInventory`.
- **Manual barcode entry** — Same inventory lookup via a typed barcode ID instead of the camera, for
  when a barcode won't scan. `lib/ui/tools/ToolsPage.dart` (`_showManualEntryDialog`/
  `_handleManualBarcodeEntry`).
- **Inventory item detail + edit status/location** — Shows name, description, count, status,
  location for a scanned item, each of status/location editable inline via a small text-entry
  dialog that PATCHes the backend and updates the page in place.
  `lib/ui/tools/BarcodeResultPage.dart`, `Database.modifyInventory`.
- **Standalone tool check-in via barcode (separate flow)** — A second, apparently newer/parallel
  tool-tracking screen: scans a barcode with `flutter_barcode_scanner` against a *different* backend
  host (`optixtoolkit-backend-production-*.up.railway.app`), looks the tool up in `/inventory/:id`,
  POSTs a "post-tool" check-in keyed by a hardcoded `reserverID = "user123"`, lists currently
  checked-in tools, and lets you check one out (HTTP DELETE) with a snackbar per action. This is the
  screen actually shown to a logged-out user (see Notable Implementation Details).
  `lib/ui/BarcodeScanner.dart` (`ToolReservationPage`).
- **Shopping list / part tracker** — Lists all parts, each row showing who ordered it (`displayName`)
  and its computed shipping status (Ordered/Shipped/Arrived/Failure, color-coded); "No Parts Exist"
  empty state; pull-to-refresh. `lib/ui/parts/PartsPage.dart`, `lib/ui/parts/PartCard.dart`,
  `Database.getParts`.
- **Part detail / remove** — Modal showing who ordered it, vendor link, tracking number, priority,
  and status; admins get a Remove button. `lib/ui/parts/PartModal.dart`, `Database.removePart`.
- **Add a part to track** — Form: name, vendor link (basic `http(s)://` validation), tracking
  number, carrier dropdown (Amazon/FedEx/UPS/USPS), and a 0–5 priority slider.
  `lib/ui/parts/PartAdd.dart`, `Database.addPart`.
- **Purchase reimbursement request** — Separate form (reachable from both the bottom nav's
  "REIMBURSEMENTS" tab and a button on the parts page): part name, part link, recipient name,
  mailing address, and a required receipt photo taken with the device camera
  (`image_picker`) and uploaded to Firebase Storage before the request is submitted; shows a
  confirmation message on success and clears the form. `lib/ui/parts/PartReimburse.dart`,
  `Auth.getImageUrl`, `Database.reimbursement`.
- **Profile / account settings** — Greeting, sign-out button, and a "change password" action that
  sends a Firebase reset email to a typed address (not a true in-place password change).
  `lib/ui/ProfilePage.dart`, `Auth.sendPasswordResetEmail`.
- **Team management (admin only)** — Visible only under the `admin` claim: a "MANAGE USERS" button
  leading to a user list. `lib/ui/ProfilePage.dart`, `lib/ui/UserList.dart`.
- **Admin: add a user** — Floating "+" on the user list opens a dialog for name, email, and an
  Admin checkbox; presumably provisions the account/claim server-side.
  `lib/ui/UserList.dart` (`_showToolService`), `Database.addUser`.
- **Admin: remove a user** — "Remove" button on each user card. `lib/ui/UserCard.dart`,
  `Database.removeUser`.
- **Admin: certify / uncertify a user** — Tapping a user opens a modal showing
  Certified/Not Certified with buttons to toggle it. `lib/ui/UserModal.dart`,
  `Database.addCertifyRole`/`removeCertifyRole`.

Not present: no CSV/spreadsheet export, no push notifications, no offline mode/local cache (every
screen re-fetches from the network on build), no in-app audit log or history view, no calendar/event
scheduling, no messaging/chat, no multi-team or multi-season support evident in the client.

## Integrations

- **Firebase Authentication** — email/password identity, custom claims for the `admin` role.
  `lib/services/firebase.dart`.
- **Firebase Storage** — reimbursement receipt photo uploads, path `user/<uid>/<filename>`.
  `lib/services/firebase.dart` (`Auth.getImageUrl`).
- **Backend at `toolkit.team3749.org`** — single POST endpoint dispatching ~20 named operations
  (parts-add/remove/get, reserve/return/checkout tools, add/remove/list users,
  certify/uncertify, reimbursement, get-seconds/get-lastcheckin/get-meetings, check-in/check-out,
  get-tools, get/modify-inventory). Not in this repo. `lib/constants.dart`, `lib/services/database.dart`.
- **A second, separate backend** at a Railway URL
  (`optixtoolkit-backend-production-*.up.railway.app`) used only by the standalone
  `ToolReservationPage` barcode check-in/out flow. `lib/ui/BarcodeScanner.dart`.
- **MongoDB (inferred)** — nightly GitHub Actions cron resets tool reservation/status fields via a
  raw `mongo` shell command against a `MONGO` secret connection string.
  `.github/workflows/mongo.yml`.
- **Carrier tracking (inferred)** — `Part.status` values (`pre_transit`, `in_transit`,
  `out_for_delivery`, etc.) match typical package-tracking-API vocabulary (e.g. AfterShip/EasyPost
  style), implying the backend polls a shipment tracker; no client-side integration code exists.
- **GitHub Actions → GitHub Releases** — CI builds and publishes signed(?) release APKs as the
  distribution mechanism. `.github/workflows/build.yml`.

## Notable Implementation Details

- **The email/password login screen is dead code at this commit.** `main.dart`'s `MainApp.build`
  returns `ToolReservationPage()` (the standalone barcode check-in screen from
  `lib/ui/BarcodeScanner.dart`) whenever there is no signed-in Firebase user — never `FormPage`. Since
  nothing in the repo constructs `FormPage`/`CreateAccount`/`ForgetPassword` except from within
  `FormPage` itself, the entire login/sign-up/forgot-password flow is currently unreachable from the
  app's actual navigation graph; only a previously-authenticated session (or the barcode-scan
  fallback page) is reachable. This looks like a mid-refactor state, not a deliberate design.
- **Two unrelated backends are wired into one build.** The main data layer
  (`lib/services/database.dart`) talks to `Constants.SERVER_URL` = `toolkit.team3749.org`, while
  `lib/ui/BarcodeScanner.dart` hardcodes a different, Railway-hosted backend URL and a hardcoded
  `reserverID = "user123"` placeholder rather than the signed-in user's uid — this screen reads as
  an in-progress prototype for a redesigned tool-checkout flow, not integrated with the rest of the
  app's auth or data model.
- **Two different barcode-scanning packages are both depended on and both used** —
  `flutter_barcode_scanner` in `BarcodeScanner.dart` vs. `barcode_scan2` in
  `lib/ui/tools/ToolsPage.dart` — for what is conceptually the same action (scan a tool/inventory
  barcode), doubling the native platform surface area for no apparent functional reason.
- **Client-computed, not source-of-truth, delivery status.** `Part.fromJson` maps a raw carrier
  status string through a fixed `deliveryMap`; an unrecognized value is silently mapped to the
  literal typo `"Faliure"` (used as a map key nowhere in `styleMap`), so such parts render with
  default, uncolored text rather than the intended red "Failure" styling.
- **Every screen re-fetches on build via `FutureProvider`/`FutureBuilder` with no cache** — e.g.
  `ToolWidget` and `PartsWidget` both call their `Database.get*` again in `initState`/`dispose` in
  addition to the provider's own future, so a single screen visit can trigger duplicate network
  round-trips (see `_toolState.initState`/`dispose` in `ToolsPage.dart`, both calling
  `refreshTools()`).
- **Authorization is UI-only.** Every admin-gated action (add/remove tool, remove user,
  certify/uncertify, remove part) is hidden by checking `idToken.claims['admin']` client-side before
  showing the button; the actual enforcement, if any, must live server-side (not visible in this
  repo) since the client sends the same bearer token regardless.
- **Account deletion is handled outside the app entirely** — `ACCOUNT_REMOVAL.md` documents an
  out-of-band process (contact support) rather than an in-app flow, seemingly added specifically to
  satisfy Play Store data-safety-section requirements rather than as a user-facing feature.
- **No tests.** No `test/` directory content beyond the Flutter-scaffold default is exercised in
  CI; `build.yml` only runs `flutter build apk`, no `flutter test`/`flutter analyze` step.
- **Known build gotcha documented in the README**: a stale
  `build/app/intermediates/signing_config/debug/out/signing-config.json` file can cause an "Access
  is denied" build error on Windows; the fix is simply deleting it.
- Committed `android.zip` and `.idea`/`.vscode` editor-config directories are checked into the repo
  root alongside source, suggesting light repo hygiene / no `.gitignore` enforcement for IDE
  artifacts (a `.gitignore` does exist but these predate or bypass it).

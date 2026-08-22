# 8793PartBot — Source Survey

**Repo:** https://github.com/pureh2oo/8793PartBot (FRC 8793 — Pumpkin Bots)
**Surveyed at commit:** `8f2390beb6e92bf69623ba0a52941ef77e8921fa`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/pureh2oo/8793PartBot/blob/8f2390beb6e92bf69623ba0a52941ef77e8921fa/<path>`

## Purpose

8793PartBot is a Discord-bot-plus-Google-Sheets purchasing/parts-request pipeline built by FRC
Team 8793 (Pumpkin Bots). Students submit part requests as Discord slash commands; a Node.js bot
forwards them to a Google Apps Script Web App bound to a Google Sheet, which stores the request,
optionally calls an LLM to auto-fill part name/SKU/price from a vendor URL, and lets mentors
approve/deny in the spreadsheet itself (no custom mentor UI — the sheet *is* the admin console).
Approval auto-creates a row in an "Orders" tab; students can query status or cancel their own
pending requests from Discord. It is a narrow, single-purpose purchasing tool, not a general team
hub — it has no attendance, roster, or communication features.

## Stack

- **Bot process:** Node.js (`package.json` has no engine pin), `discord.js` v14 for slash-command
  registration and interaction handling, `axios` for HTTP calls to the Apps Script Web App. Single
  file, `bot.js` (576 lines).
- **Backend/data layer:** Google Apps Script (`apps-script/Code.js`, 858 lines) bound to a Google
  Sheet, deployed as a Web App (`doGet`/`doPost`). The spreadsheet itself is the database — three
  tabs (`Part Requests`, `Orders`, `Inventory`) accessed via `SpreadsheetApp`/`getDataRange()`, no
  external DB.
- **AI enrichment:** the checked-in `Code.js` calls **OpenAI** `gpt-4.1-mini`
  (`apps-script/Code.js:11-14`, `getPartInfoFromAI`) via `UrlFetchApp.fetch`, using an
  `OPENAI_API_KEY` script property. Note: the README describes a *different*, apparently newer
  production version using **Google Gemini 2.5 Flash** with a Discord webhook and budget tracking
  — see Notable Implementation Details, this is a real drift between the committed code and what
  README/`bot.js` describe as deployed.
- **Hosting:** the bot process runs on a self-managed Google Compute Engine `e2-micro` VM (Ubuntu
  22.04) under PM2 for process supervision/restart-on-reboot; the Apps Script side is hosted
  entirely inside Google's infrastructure (`README.md`, VM Setup section).
- **License:** No `LICENSE` file is present in the repository despite the README and `bot.js`'s
  header comment both referencing one ("Full license text available in the project root LICENSE
  file", `bot.js:1-28`). The stated terms (in the README's License section and the `bot.js`
  header) are a custom "MIT License with Use Notification Requirement" — permissive like MIT but
  asks users to notify Team 8793 by email or GitHub issue. `package.json` separately declares
  `"license": "ISC"` as a metadata field, which is inconsistent with the README/header. **Flag:
  no enforceable LICENSE file exists; the actual terms are ambiguous, and any reuse should treat
  this as effectively unlicensed until clarified with the maintainers.**
- **Single squashed commit.** `git log` shows exactly one commit (`8f2390b`, 2026-08-21), so there
  is no development history to inspect — this appears to be a fresh public push of an
  already-developed private project, not an incremental history.

## Auth & Roles

- **No user accounts, no login, no role model in code.** Identity is whatever Discord reports
  (`interaction.user.username`) and whatever a mentor types into a spreadsheet cell.
- **Student role (implicit):** anyone who can run slash commands in the Discord server can
  request parts (`/requestpart`) and cancel only requests where `canceller` (their Discord
  username) is expected to match — but the actual ownership check happens (per README) inside the
  *production* Apps Script's `cancelRequest` handler, which is **not present** in the committed
  `Code.js` (see Notable Implementation Details). As checked in, the code has no cancellation
  endpoint at all.
- **Mentor/admin role (implicit):** anyone with edit access to the Google Sheet. Approval is done
  by mentors typing "Approved" into the Request Status column, which fires `onEdit` →
  `approveRequest` (`apps-script/Code.js:205-234, 793-839`). There's no distinct "mentor" flag —
  spreadsheet edit permissions *are* the authorization boundary.
- **Web App access:** deployed with `"executeAs": "USER_DEPLOYING"` and
  `"access": "ANYONE_ANONYMOUS"` (`apps-script/appsscript.json`) — the `doPost`/`doGet` endpoint is
  unauthenticated and callable by anyone who has the URL; there is no shared-secret or signature
  check on inbound requests from the Discord bot.

## Data Model

All state lives in three Google Sheet tabs (no formal schema beyond column position/comments in
code); columns are 1-indexed via `getRange(row, col)` calls.

- **Part Requests** (`apps-script/Code.js:77-95` comment block) — columns A–S: Request ID
  (`REQ-xxxxxxxx`, first 8 chars of a UUID), Timestamp, Requester, Subsystem, Part Name, SKU, Part
  Link, Qty, Priority, Needed By, Inventory On-Hand, Vendor Stock, Est Unit Price, Total Est Cost,
  Max Budget, Budget Status, Request Status (`Requested`/`Approved`/`Ordered`/`Denied`/…), Mentor
  Notes, Expedited Shipping.
- **Orders** (`apps-script/Code.js:480-484` comment block) — columns A–O: Order ID (`ORD-xxxxxxxx`),
  Included Request IDs (comma-joined, so one order can bundle multiple requests — though
  `approveRequest` only ever writes a single request ID per order), Vendor, Part Name, SKU, Qty
  Ordered, Final Unit Price, Total Cost, Order Date, Shipping Method, Tracking, ETA, Received Date,
  Order Status, Mentor Notes.
- **Inventory** (`apps-script/Code.js:595-599`) — columns A–I: SKU, Vendor, Part Name, Location,
  Qty On-Hand (plus Reorder Threshold / Usage Rate / Last Count Date / Notes per the README's
  column list, unused by the code read).
- No foreign keys or referential integrity of any kind — everything is string/number matching over
  `getDataRange().getValues()` linear scans (e.g. `handleOrderStatus_` scans every Orders row and
  string-splits the "Included Request IDs" cell to find matches, `apps-script/Code.js:486-513`).

## Features

- **Submit a part request (`/requestpart`)** — subsystem (fixed choice list: Drive, Intake,
  Shooter, Climber, Mechanical, Electrical, Vision, Pneumatics, Software, Safety, Spares, Other),
  optional vendor link, optional **user-specified SKU override**, quantity, max budget, priority
  (Critical/High/Medium/Low), notes. `bot.js:111-155` (command definition), `bot.js:251-301`
  (`handleRequestPart`), `apps-script/Code.js:157-200` (`handleDiscordRequest_`).
- **Google Form intake path (parallel to Discord)** — an `onFormSubmit` trigger performs the same
  row-creation logic for a linked Google Form, so non-Discord submission is also supported.
  `apps-script/Code.js:40-98`.
- **AI-assisted part enrichment** — after a request with a link is created, `enrichPartRequest`
  fetches the vendor page HTML, sends URL + HTML snippet + user notes to OpenAI
  (`gpt-4.1-mini`) with a strict-JSON prompt, and writes back Part Name, SKU, estimated price, and
  stock status; it deliberately discards any AI-guessed SKU that doesn't literally appear in the
  fetched HTML (with an extra dedicated check for WCP's multi-variant ball-bearing page), to avoid
  silently ordering the wrong variant. `apps-script/Code.js:240-410`.
- **Manual re-enrichment from the spreadsheet menu** — a custom "FRC Purchasing" menu adds
  "Enrich selected request (AI)", letting a mentor re-run enrichment on the currently selected row.
  `apps-script/Code.js:28-34, 307-323`.
- **Inventory lookup (`/inventory`)** — by exact SKU or fuzzy keyword/location search (matches
  against SKU and Part Name substrings), returning stock, vendor, and location; single match shows
  full detail, multiple matches show a capped list (10). `bot.js:185-193, 516-568`,
  `apps-script/Code.js:578-652` (`handleInventoryLookup_`).
- **Auto-inventory-check on enrichment** — once an SKU is known, `enrichPartRequest` looks up
  current on-hand quantity in the Inventory tab and writes it into the request row's "Inventory
  On-Hand" column, so a mentor sees at a glance whether the team already has stock before
  approving a purchase. `apps-script/Code.js:301-304, 558-573`.
- **Mentor approval via spreadsheet edit (`onEdit` trigger)** — a mentor typing "Approved" into
  the Request Status column of a request row automatically creates a linked Orders row (vendor is
  inferred from the URL domain), sets the request's status to "Ordered", and refuses if the
  request's Budget Status starts with "Over Budget" (throws rather than silently approving).
  `apps-script/Code.js:205-234, 793-839`.
- **Approve via custom menu** — "Approve selected request" menu item runs the same
  `approveRequest` logic against the currently selected row, as an alternative to editing the
  status cell directly. `apps-script/Code.js:28-34, 770-788`.
- **Vendor auto-detection from URL** — maps a request/order link's domain to a display vendor name
  (REV Robotics, AndyMark, McMaster-Carr, VEX Robotics, DigiKey, Amazon, West Coast Products, CTR
  Electronics, Home Depot, PowerWorx, SendCutSend, Foam Order; else "Other Vendor").
  `apps-script/Code.js:842-858` (`extractVendorFromURL`).
- **Open orders / denied requests view (`/openorders`)** — lists every Orders-tab row with no
  Received Date and a non-"Cancelled" status, plus every Part-Requests row whose status is
  "Denied", each capped at 15 shown with a "Total: N" count. `bot.js:171-173, 386-444`,
  `apps-script/Code.js:657-765` (`handleOpenOrders_`).
- **Order/request status lookup (`/orderstatus`)** — accepts either a request ID or an order ID;
  for a request ID it also cross-references and lists every order that includes that request ID.
  `bot.js:175-183, 446-514`, `apps-script/Code.js:415-553` (`handleOrderStatus_`).
- **Discord-side formatting helpers** — human-readable date formatting, currency formatting, and a
  Unicode block-character progress bar (`█`/`░`) used for budget visualizations.
  `bot.js:50-79` (`formatDate`, `formatEta`, `formatCurrency`, `buildProgressBar`).
- **Budget snapshot / `/budgetstatus` command** — `bot.js` defines a `budgetstatus` slash command
  and a full handler (`handleBudgetStatus`, `bot.js:167-169, 339-384`) that expects the backend to
  return season budget totals (allocated/spent/remaining, per-event breakdowns, percent-used flag
  thresholds at 90%/negative-remaining). **The committed `apps-script/Code.js` `doPost` router has
  no `budgetStatus` action branch** — calling this command against the checked-in backend would
  return the router's generic `{status:'error', message:'Unknown action'}`. See Notable
  Implementation Details.
- **Student self-cancellation (`/cancelrequest`)** — `bot.js` defines and calls this
  (`bot.js:157-165, 303-337`), posting `{action:'cancelRequest', requestId, canceller, reason}`.
  **Not implemented in the committed `apps-script/Code.js`** — same drift as budget status.

Not present (as committed): no attendance, roster/people directory, calendar, team-wide
communication/announcement feature, CSV export, or web dashboard. The README's "Planned Features"
section lists OnShape BOM import, reimbursement-form generation, direct vendor ordering APIs,
inventory QR scanning, a budget/spend dashboard, and a mentor web UI as explicitly unbuilt.

## Integrations

- **Discord** — `discord.js` v14 REST guild-command registration
  (`Routes.applicationGuildCommands`) and gateway client with only the `Guilds` intent; all
  responses are ephemeral except `/budgetstatus`. `bot.js:31-43, 197-249`.
- **Google Sheets** as the datastore, accessed only from the Apps Script side (never directly by
  the bot). `apps-script/Code.js` throughout.
- **Google Forms** as an alternate request-submission channel via an `onFormSubmit` installable
  trigger. `apps-script/Code.js:40-98`.
- **OpenAI Chat Completions API** (`gpt-4.1-mini`, JSON-mode) for part enrichment, called from
  Apps Script via `UrlFetchApp`, key stored in Apps Script's `PropertiesService` script properties.
  `apps-script/Code.js:325-410`. (README additionally documents a Gemini 2.5 Flash integration and
  a `DISCORD_PROCUREMENT_WEBHOOK_URL` Apps-Script property for a Discord webhook, neither of which
  appears in the committed code.)
- **Vendor product pages** — arbitrary URL fetched server-side (`UrlFetchApp.fetch`) to scrape raw
  HTML for AI enrichment context, capped at the first 15,000 characters. `apps-script/Code.js:245-257`.
- **PM2 process manager** on a self-hosted GCE VM for the bot's own uptime, not a Discord/Google
  integration but the deployment target. `README.md` (VM Setup / Useful Commands sections).

## Notable Implementation Details

- **Committed code lags documented/production behavior.** The README explicitly describes an
  architecture using Gemini 2.5 Flash, a `DISCORD_PROCUREMENT_WEBHOOK_URL`, and a
  `cancelRequest`/`budgetStatus` workflow with per-event budget breakdowns and an "In Inventory"
  formula column — none of which exist in the single `apps-script/Code.js` file actually committed
  to this repo (which still uses OpenAI and only implements `inventory`, `discordRequest`,
  `orderStatus`, and `openOrders` actions). Likewise `bot.js` defines and calls `/cancelrequest` and
  `/budgetstatus` handlers that would 404 (functionally) against this backend. A rebuild based on
  this repo should treat the README as aspirational/historical and the code as the ground truth for
  what's actually reproducible, while noting the gap.
- **Unauthenticated, anonymous Web App endpoint.** `appsscript.json` deploys with
  `"access": "ANYONE_ANONYMOUS"` and no shared secret is checked in `doPost` — anyone who obtains
  the `/exec` URL (e.g. from a compromised `.env` or VM) can submit or query data at will. There is
  also no rate limiting.
- **AI SKU hallucination guard.** Rather than trusting the LLM's returned SKU, `enrichPartRequest`
  greps the raw fetched HTML for the SKU string (case-insensitive substring) and discards the SKU
  if not found — a lightweight but real defense against a wrong-variant purchase, with an extra
  specific check hardcoded for one WCP product URL pattern. `apps-script/Code.js:272-294`.
- **No idempotency/duplicate protection.** Every Discord submission or form row unconditionally
  appends a new Part Requests row and immediately calls enrichment inline (synchronously, within
  the `doPost` request), so a slow vendor-page fetch or OpenAI call directly extends the Discord
  interaction's response latency (discord.js interactions must be deferred within 3 seconds, which
  `handleRequestPart` does via `interaction.deferReply`).
  `apps-script/Code.js:157-200`, `bot.js:260`.
- **Request/Order IDs are UUID-fragment based, not sequential.** `REQ-`/`ORD-` prefix plus the
  first 8 hex characters of `Utilities.getUuid()` — collision-resistant in practice but not
  visually ordered by creation time the way an incrementing counter would be.
  `apps-script/Code.js:71-72, 175-176, 817`.
- **Budget rejection is a hard `throw`, not a soft warning.** `approveRequest` throws if the
  request's Budget Status cell starts with "Over Budget", aborting the approval entirely rather
  than just flagging it — a mentor must edit the budget or Max Budget value before "Approved" will
  stick. `apps-script/Code.js:813-815`.
- **`onEdit` trigger is single-cell-scoped.** It fires on every edit anywhere in the workbook but
  short-circuits unless the edited cell is column 17 (Request Status) of the Part Requests sheet
  and its new value is exactly `"approved"` (case-insensitive, trimmed) — bulk-pasting statuses
  into multiple rows at once will only reliably trigger approval logic per Apps Script's own
  single-cell-edit event semantics, not documented as multi-row safe. `apps-script/Code.js:205-234`.
- **Everything table-scans.** Every lookup (`handleOrderStatus_`, `handleInventoryLookup_`,
  `handleOpenOrders_`) calls `getDataRange().getValues()` and does a linear `for` loop; fine at
  hobby-project sheet sizes, will degrade linearly as rows grow into the thousands, and there are
  no sheet-level indexes possible in the Sheets/Apps Script model.
- **Deployment is entirely manual/console-driven**, not committed as code: Apps Script deploy
  version bump is "Deploy → Manage deployments → Edit → New version → Deploy" done by hand in the
  browser IDE (`README.md`), and there is no CI, no test suite, no `.clasp`-based push in the
  documented workflow despite a `.clasp.json` file existing in `apps-script/` (its `scriptId` was
  not inspected further as it's account-specific and not meaningful to reuse).
- **Single squashed git history (1 commit).** No incremental commits to trace the OpenAI→Gemini
  migration, cancellation feature, or budget feature described in the README; this is a snapshot
  publish, not a working history.
- **Last activity / activity status:** the sole commit is dated 2026-08-21 (one day before this
  survey), and the README documents an August 2026 VM-rebuild recovery effort ("The original VM was
  lost and functionality was restored using these exact steps"). The tool reads as actively used by
  a single team (8793) for the current build season, with a small maintainer/team footprint and no
  external contributors visible in this snapshot.

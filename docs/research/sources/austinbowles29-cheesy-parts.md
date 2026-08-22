# Cheesy Parts Tracker — Source Survey

**Repo:** austinbowles29/cheesy-parts — https://github.com/austinbowles29/cheesy-parts
**Surveyed-at:** 51eb7eb840e91b2fff099bacd1ccfa3606a9f605
**Permalink form:** https://github.com/austinbowles29/cheesy-parts/blob/51eb7eb840e91b2fff099bacd1ccfa3606a9f605/<path>
**Stack:** Next.js (App Router) + TypeScript, Vercel deployment, Airtable as the system-of-record database, Vercel Blob for file/state storage, Slack Web API, Onshape REST API + OAuth2
**License:** none (all rights reserved) — no LICENSE file in the tree and `license` is null via the GitHub API; ideas only, do not copy code.
**Last activity:** 2026-08-16 (pushed_at; commit date matches, actively developed)
**FRC team:** Team 254 (README: "Cheesy Parts Tracker is Team 254's beta manufacturing submission and queue tool" — this is 254's next-gen rebuild of their well-known original Cheesy Parts tool; repo owner appears to be a 254 member/mentor)
**Areas:** part design/manufacturing tracking (primary); third-party integrations (Onshape, Airtable, Slack) as the mechanism; communication (Slack notifications)

## Purpose
Lets a CAD designer select a part inside Onshape, review auto-filled metadata in an embedded side panel, and submit a manufacturing request directly into a shared queue — eliminating manual re-entry of part name/number/material into a spreadsheet or ticket. The queue is a dashboard for the shop floor to triage, update status, and request spares, with Slack notifications keeping both designers and manufacturing informed of new requests and status changes.

## Auth & Roles
No app-level user accounts or RBAC. Two lightweight identity mechanisms instead:
- **Onshape OAuth2** (`src/lib/integrations/onshape.ts`) — authorizes the panel to call the Onshape API on the designer's behalf (read part/BOM metadata, export drawing PDFs). Tokens stored in HTTP-only cookies (`onshape_access_token`, `onshape_refresh_token`, `onshape_token_expires_at`) with CSRF-style `onshape_oauth_state` cookie.
- **Slack identity resolution** (`src/lib/integrations/slack-users.ts`) — resolves submitters/mentions to Slack users via usergroups (`design`, `design-rooks` by default) and `users.list`, used only to @-mention people in notifications, not for access control.
- No login wall on the queue dashboard or submission panel; anyone with the URL can view/submit/edit. Airtable webhook calls are authenticated by a shared `secret` query param compared against `AIRTABLE_WEBHOOK_SECRET`.

## Data Model
No app-owned SQL/NoSQL database — **Airtable is the source of truth** (`src/lib/integrations/airtable.ts`). Central entity is `ManufacturingRequest` (`src/lib/types.ts`):
- Identity/linkage: `id`, `airtableId`, `airtableUrl`, `airtableTableId`/`airtableTableName`, `slackChannelId`/`slackMessageTs`, `sourceRequestId` (for spares linked to an original part)
- Part fields: `partName`, `partNumber`, `notes`, `quantity`, `subsystem`, `category` (Robot/Spares/Lab General/Offseason/Other), `material`, `thickness`, `finish`, `machineType`
- Onshape linkage: `onshapePartUrl`, `onshapeDrawingUrl`, `assemblyUrl`, `branchVersionReference`
- Workflow: `status` (7-stage enum, see Features), `priority`, `submitter`/`submitterSlackId`, `submittedAt`, `manufacturingNotes`, `attachments: AttachmentRef[]`, `auditHistory: AuditEntry[]`
- Category-specific extension fields on the same record: 3DP (`printMaterial`, `printColor`, `infill`, `layerHeight`, `printerNotes`) and vendor/outsourced (`vendorName`, `quoteRequired`, `leadTime`, `vendorNotes`)
- `AuditEntry` — append-only log of `submitted | status_changed | spares_created | airtable_synced` actions with actor, timestamps, from/to status
- Supports **multiple Airtable base tables** simultaneously (e.g. main robot-parts table + a separate Spares table), routed via `AIRTABLE_TABLES`, `AIRTABLE_CATEGORY_TABLE_MAP`, or a manual "Tracking table" selector when multiple are configured
- Local/dev fallback persistence to a flat JSON file (`src/lib/storage/local-store.ts`) when Airtable isn't configured; Vercel Blob used for cross-invocation state (comment-thread dedupe, webhook dedupe) in serverless deploys

## Features

**Part design/manufacturing tracking**
- Onshape-embedded submission panel at `/onshape` (`src/app/onshape/page.tsx`, `src/components/onshape-submission-panel.tsx`) — reads part context from query params Onshape passes into a custom panel/extension (`docs/onshape-panel.md` lists ~20 supported params: `documentId`, `workspaceOrVersion`, `elementId`, `partId`, etc.)
- Auto-fills part name/number/material/notes/drawing links via Onshape OAuth + API metadata lookup (`src/lib/integrations/onshape.ts`); falls back to scanning Assembly BOMs in the same document for a part number match when the selected part itself has none, matching by `partId` first then part name
- Structured part numbering scheme with per-subsystem prefixes (Drive=0100, Bumpers=0200, Intake=0300, etc.) and auto-incrementing sequence per prefix (`src/lib/part-numbering.ts`)
- Heuristic machine-type inference from material/part-name/thickness (e.g. "3DP" from PLA/PETG keywords, "Lathe" from shaft/spacer/pin, "Laser" vs "CNC Router" from acrylic/polycarb thickness threshold) — `deriveMachineType` in `src/lib/manufacturing.ts`
- Drawing PDF auto-attach: if not manually uploaded, server searches drawing elements in the same Onshape document and accepts a match only if the drawing's views reference exactly the selected part ID, falling back to exact-name match (`src/lib/integrations/onshape.ts`, documented in `docs/onshape-panel.md`)
- Manufacturing queue dashboard at `/` (`src/components/queue-dashboard.tsx`) — status-card filters, search + dropdown filters (subsystem/machine type/status/submitter/material), status changes, links out to Airtable/Onshape part/drawing/assembly, delete requests, auto-refresh while tab is visible, "last synced" indicator
- 7-stage status pipeline: Needs CAM → Needs Drawing → Ready for Manufacture → Manufacturing In Progress → Ready for Assembly → Ready for Anodize/Powdercoat → Done for Spares (`src/lib/constants.ts`), with status alias normalization for messy free-text Airtable values (`coerceStatus` in `src/lib/manufacturing.ts`)
- Spare-part request flow — clone an existing request as a new spares queue entry with its own quantity, linked back via `sourceRequestId` (`src/app/api/requests/[id]/spares/route.ts`, `src/lib/service.ts`)
- Category-specific extra fields surfaced only when relevant: 3D-print fields (material/color/infill/layer height/printer notes) and vendor/outsourcing fields (vendor name, quote required, lead time, vendor notes)
- Audit trail per request (`AuditEntry`) recording every status change/spares creation/Airtable sync

**Third-party integrations**
- Onshape: OAuth2 app + Store panel entry, part/BOM metadata reads, drawing PDF export/translation, and inbound Onshape comment webhooks that relay CAD comment threads into Slack (`src/app/api/onshape/webhooks/comments/route.ts`, `src/lib/integrations/onshape-comments.ts`)
- Airtable: full CRUD via REST API, schema introspection to source dropdown choices (Subsystem, Vendor) live from Airtable's own select-field options, queue reads scoped to a named view (`AIRTABLE_QUEUE_VIEW`, default "To manufacture") to avoid loading full history, plus an inbound webhook (`src/app/api/airtable/webhook/route.ts`) for manual status changes made directly in Airtable to sync back and trigger Slack notices, with dedupe via `src/lib/storage/webhook-dedupe.ts`
- Slack: `chat.postMessage` (bot token) or incoming webhook URL, separate channels for manufacturing/status/3DP/Onshape-comments, plus usergroup-based @-mention resolution (`src/lib/integrations/slack-users.ts`, `src/app/api/slack/manufacturing-users/route.ts`)

**Communication**
- New-request and status-change Slack notifications with thread continuity (`slackMessageTs` stored per request so status updates reply in-thread)
- Onshape CAD comment → Slack relay, threading Slack replies back to the same CAD comment (`src/lib/storage/onshape-comment-threads.ts`)

## Integrations
Onshape (OAuth2 + REST, panel embed), Airtable (REST API as primary DB, webhooks in), Slack (Web API + incoming webhooks), Vercel Blob (durable state/file storage in serverless deploys).

## Notable Implementation Details
- **Airtable-as-database is the core architectural bet.** No SQL schema to design/migrate — status enum, subsystem list, and dropdown choices are read live from Airtable's field schema when the token has schema-read scope, which lets shop staff add a new subsystem/vendor by editing an Airtable select field with zero code deploy. Trade-off: request volume/complexity is bounded by Airtable API rate limits and its per-base row limits.
- Uses Vercel Blob for two purposes beyond files: a JSON-blob "comment thread" map (Onshape comment → Slack ts) and a webhook dedupe marker store, both with local-filesystem fallbacks for dev — a workable pattern for serverless state without adding a real DB.
- Part-number-driven subsystem inference: `numberingSubsystemFromPartNumber` derives subsystem purely from the part number's 4-digit prefix, letting the UI auto-select an Airtable dropdown choice from a pasted/scanned part number.
- Drawing-PDF auto-match logic is deliberately conservative — only auto-attaches a drawing if its views reference *exactly* the selected part ID (or exact name as fallback), avoiding false-positive attachment on multi-part drawings.
- `deriveMachineType` is a regex/keyword heuristic, not authoritative — always designer-reviewed per the README ("Auto-filled data is a starting point").
- Handles Onshape's extension replacement-token quirk: if Onshape leaves a literal unsubstituted token like `{$partNumber}` in a query param, the panel detects and discards it rather than treating it as real data (`firstPanelParam` in `src/lib/onshape-panel-defaults.ts`).
- Session-storage caching of fetched Onshape panel data (`src/lib/onshape-panel-session.ts`) to avoid refetching Onshape metadata when a user reopens the same part context within 30 minutes.
- No RLS/RBAC at all — access control is entirely "if you have the link" plus a shared webhook secret; a reimplementation with real accounts should add per-role write scoping (e.g. only manufacturing can move to "Ready for Assembly").

## Verdict
Substantive and directly on-target: a real, actively-maintained (this week) next-gen rebuild of Team 254's original Cheesy Parts by what looks like a 254-affiliated author, covering the full Onshape→queue→Slack manufacturing pipeline. Worth stealing as ideas: the part-number-prefix-to-subsystem convention, the conservative drawing-PDF auto-match rule, and using a spreadsheet-like backend (schema-read-driven dropdowns) to let non-engineers edit workflow taxonomy without code changes. All rights reserved — no license file — so treat as ideas-only, do not copy code verbatim.

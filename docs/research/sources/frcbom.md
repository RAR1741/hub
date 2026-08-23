# FRC BOM — Source Survey

**Site:** https://frcbom.com/
**Docs:** https://docs.frcbom.com/ (Docsify-style hash-routed SPA, `#/guide/<slug>`)
**Chief Delphi threads:**
- [Introducing FRCBOM.com — Simplifying BOM Experience (Using Onshape API)](https://www.chiefdelphi.com/t/introducing-frcbom-com-simplifying-bom-experience-using-onshape-api/476900) (Dec 2024, original launch)
- [Introducing [again] FRCBOM.com](https://www.chiefdelphi.com/t/introducing-again-frcbom-com-a-bom-and-manufacturing-dashboard-for-teams-using-onshape-api/505737)
- [[FRCBOM UPDATE] Google Sign-In, Full Onshape OAuth Integration, Inventory Tracking & More](https://www.chiefdelphi.com/t/frcbom-update-google-sign-in-full-onshape-oauth-integration-inventory-tracking-more/520938) (May 2026)

**Method note:** this is an **outside-in survey — no source code available.** No public GitHub
repository was found for FRC BOM (searched "frcbom github repository"; only the docs/marketing
site and unrelated repos surfaced). FRC BOM is **closed-source**, hosted SaaS. Everything below is
reconstructed from the public site, its docs, and Chief Delphi posts by the author. Author:
**David Masin** (Chief Delphi handle `DavidMasin`, FRC Team 4414 "HighTide," per the "Team 4414 |
HighTide | 2026 Tech Binder" reference in the launch thread's reply stream). No repo to pin.

## Purpose

FRC BOM is a hosted Bill-of-Materials / manufacturing-tracking dashboard built specifically for FRC
build teams, centered on a live sync from Onshape CAD. Pitch line from the marketing site: **"The
BOM your build team actually uses."** [Site] It targets the same internal need as a team's
spreadsheet BOM — tracking what parts exist, what they're made of, what manufacturing steps they
need, and how far along they are — but replaces manual spreadsheet upkeep with an automatic feed
from CAD, plus purchasing/inventory tracking for COTS (commercial off-the-shelf) parts. [Site]
[Docs]

It fits squarely in this project's survey rubric under **design→manufacturing workflow tracking**
and **purchasing/part tracking**, with no attendance, scouting, or general team-communication
scope.

## Stack (as determinable from outside)

Nothing here is verified against source; all inferred from client-observable behavior, docs
wording, and author statements.

- **Frontend:** the main app is a client-rendered web app (`frcbom.com`) with a 3D CAD viewer
  embedded in-browser (glTF viewer, per the "3D viewer & CAD downloads" doc page and file-export
  formats below). The docs site itself is a **Docsify**-style static-site generator: hash-based
  routing (`docs.frcbom.com/#/guide/<slug>`), a `Loading the FRCBOM guide…` splash before content
  mounts client-side, sidebar generated from a nav config, and per-page anchors — consistent with
  Docsify or a very similar client-side Markdown-doc renderer. [Docs]
- **Backend/API:** not observable from outside; the CD launch thread states the *original* (Dec
  2024) version stored data in "a single JSON file" and that this was later "replaced with a proper
  database for speed, reliability, and scalability" per a later post — exact DB engine not stated.
  [CD]
- **Onshape integration:** originally driven by a **custom Onshape FeatureScript** the team had to
  add to their CAD documents (`setProcesses` FeatureScript, read API keys) — per the Dec 2024
  launch post. [CD] This was **fully replaced** by an **Onshape OAuth + webhook** integration
  (announced May 2026): FRC BOM now registers a webhook per linked Onshape document and receives
  push notifications on every save, re-syncing "within a few seconds" (docs claim ~1 second) with
  no FeatureScript or API-key setup required for a normal team. [Docs] [CD] An "API keys instead"
  fallback still exists in Settings for teams whose Onshape custom-property names for
  Material/Process differ from FRC BOM's defaults. [Docs]
- **Auth backend:** Google OAuth sign-in (session-based, presumably a server session or JWT — not
  observable), plus a legacy shared "Team password" (user password / admin password) login mode
  still supported for shared-terminal shops. [Docs] [Site]
- **Hosting/cost model:** "Free for FRC teams — no credit card required. Hosting is funded by the
  project." [Site] No pricing tiers found; single free tier.
- **Mobile:** docs reference "The mobile app" as a getting-started topic, implying a native or
  PWA mobile client exists alongside the web app — not further characterized from the crawled
  pages. [Docs]

## Auth & Roles

- **Sign-in methods:** email + password (self-registered, "any email works"), Google OAuth
  ("Continue with Google" — FRC BOM never sees the password), and a legacy **Team password** mode
  (one shared user password + one shared admin password per team, for shared-terminal shops).
  [Docs]
- **Personal vs. shared accounts:** docs explicitly recommend personal (email or Google) accounts
  over the legacy shared team password, because (a) offboarding a graduating senior is just
  removing their account rather than rotating a shared password, and (b) only a personal account
  can be assigned as **Designer** or **Fabricator** on a part, which feeds the "My Parts" panel.
  [Docs]
- **Three roles, strictly nested — Owner > Admin > Member:**
  - **Member** (default role): views robots/systems in a workshop view (filter by All/COTS/
    In-house, by material, search by name); updates per-process completion counts on parts; drags
    cards across a Kanban board (Not Started/In Progress/Done/COTS); can set **Designer**,
    **Fabricator**, and per-process **manufacturer** assignment on any in-house part (a
    "who's working on this" handle open to all members, not gated to admins); sees a personal
    "My Parts" panel for anything they're assigned to; downloads CAD files for parts on their
    machine; views dashboards and the 3D viewer; uses the Onshape side panel read-only (view BOM,
    mark progress — cannot link assemblies or edit BOM structure); can connect their **own**
    Onshape account (to spread API-rate-limit load off the owner's account). Admins can optionally
    unlock a scoped Settings view for members to edit team-level "Manufacturing responsibility" and
    "Material responsibility" defaults. [Docs]
  - **Admin:** everything a member can, plus create/rename/delete robots and systems; link systems
    to Onshape assemblies; edit BOM structure (classify In-house/COTS, assign materials/processes,
    add manual parts, soft-delete/restore); generate Part Numbers (per-part or bulk) and toggle
    "Sync to Onshape" (renames parts back in the CAD document); set per-system part-number
    subsystem code/System #; manage machines and materials catalogs; manage COTS inventory and
    FRC-Orders linking, including bulk "Order mode" (auto-link, reserve quantities, per-vendor CSV
    export); manage members (invite, approve/deny join requests, promote/demote/remove); toggle
    team policies (join requests, Box Mode, Part Number pattern); manage the team's Onshape
    owner-connection and API-key fallback. [Docs]
  - **Owner:** everything an admin can, plus is the only role that can **transfer ownership**, is
    the only account guaranteed not to be removable by another admin, and is the team's default
    Onshape connection (i.e., the account whose Onshape OAuth grant the whole team's sync runs
    through, by default). Ownership is assigned automatically to whoever creates the team; a
    departing owner should transfer ownership first, but if they don't, the first admin to sign in
    with Google when the owner slot is empty can claim it from Settings — and if there's no admin
    either, the docs say to "contact us." [Docs]
- **Team isolation / multi-tenancy:** every team is siloed by team number (`frcbom.com/<team>/...`
  URL structure); the Dec 2024 launch post states team passwords are encrypted and each team's BOM
  is "securely locked" so "ONLY team 1111 can access 1111's BOM." [CD]
- **Demo account:** a "try the demo team" sandbox with sample robots, described as auto-deleting
  after a set time — lets a prospective team explore without registering. [Docs] [Site]

## Features (by evidence)

All items below are [Docs] unless otherwise marked; page anchors are the docs' own section slugs.

- **Live Onshape → BOM sync via webhooks.** Linking a system to an Onshape assembly registers a
  webhook; every save in Onshape pushes a change notification, and FRC BOM re-syncs in the
  background within seconds (marketing claims ~1 second). Manual "Refresh" from the Onshape side
  panel is also available as a fallback trigger. *(How parts flow in)*
- **Field-level sync from Onshape custom properties.** Per part: Name, Description, Quantity,
  Material (from an Onshape "Material" custom property), Pre-Process, Process 1, Process 2 (from
  correspondingly named custom properties), thumbnail image, and last-edited user/timestamp.
  Configurable custom-property IDs exist for Enterprise accounts using non-default property names.
  *(How parts flow in)*
- **Automatic In-house vs. COTS classification** on first sync, based on whether a part's source
  document matches the system's own linked assembly (same document ⇒ In-house; different document,
  e.g. a vendor subassembly ⇒ COTS); admins can override, and the override survives future syncs.
  *(How parts flow in, COTS/inventory)*
- **Configurations and suppressed-parts handling** — Onshape part configurations each become a
  separate BOM row; suppressed Onshape parts are excluded, matching what Onshape itself reports as
  the assembly BOM. Standard hardware not present in the Onshape BOM (e.g. screws only in mates)
  is not pulled unless added manually. *(How parts flow in)*
- **Systems & "Main" aggregate view.** A "robot" (one season's machine) is divided into "systems"
  (subsystems: Drivetrain, Arm, Intake, etc.), each linked 1:1 to one Onshape assembly; a reserved
  `Main` system auto-aggregates every system's parts into one robot-wide view. *(Systems and
  "Main")*
- **Per-system and per-robot dashboards** with a 3D viewer — clicking a part in the BOM highlights
  it in the 3D model and vice versa; parts with at least one assigned process render green in the
  viewer (per the CD update post screenshot description). *(Dashboards; 3D viewer & CAD downloads)*
  [CD]
- **Kanban-style progress tracking** — Not Started / In Progress / Done / COTS columns,
  drag-and-drop by any member; plus a table/workshop view filterable by classification, material,
  and free-text search. *(Tracking progress; Roles)*
- **Manufacturing pipeline stages** — configurable "machines" each with a Stage (Process or
  PreProcess) and a default CAD download format (STEP/DXF/STL, etc.); parts track completion counts
  per assigned process (e.g., CNC mill, lathe, router, 3D print) via +/- style increment controls
  (per the original 2024 launch description) evolved into fuller per-process editing in the current
  version. *(Getting started — Step 4; original CD launch post's "+ and - buttons")* [Docs] [CD]
- **Part Numbers** — a configurable, per-team pattern (with per-system subsystem codes and a
  System # input) that auto-generates part numbers per-part or in bulk, and can push the generated
  numbers back into Onshape by renaming the actual CAD parts ("Sync to Onshape" toggle). *(Part
  numbers)*
- **Part Groups and "merging listings"** — tools to consolidate BOM rows that represent the same
  logical part appearing multiple times (e.g., across configurations or duplicate imports).
  *(Merging listings; Part Groups — titles only, not deep-crawled)*
- **Designer & Fabricator assignment** — any in-house part can have a Designer, a Fabricator, and a
  per-process manufacturer assigned (open to all members, not just admins); assigned users see a
  personal **"My Parts"** panel atop any system they're involved in. *(Designer & Fabricator;
  Roles)*
- **COTS / vendor purchasing pipeline, integrated with FRC Orders** (a separate community catalog
  at `orders.frctools.com` covering AndyMark, REV, WCP, ThriftyBot, etc. with SKUs/prices/images/
  stock):
  - Manual or **bulk "Auto-link unlinked"** matching of COTS BOM rows to FRC Orders products (up to
    100 parts/pass), by name search or by pasting a vendor product URL.
  - **"Order mode"** groups COTS parts by vendor, supports per-part **reserve quantities**
    (order qty = needed − available + reserve), and shows a running estimated total cost.
  - **Per-vendor CSV export** (name, qty needed, qty in stock, qty to order, SKU, price) for
    placing actual purchase orders.
  - Vendor links are stored **per robot, keyed by part** (not per-system), so the same part
    reused across multiple systems on one robot shares its FRC Orders link.
  *(COTS, inventory & FRC Orders)*
- **Team-wide inventory tracking** for COTS parts, separate from any one robot's BOM need — "what
  we own across the whole shop." *(COTS, inventory & FRC Orders)*
- **Box Mode (optional, toggle in Settings)** — a second, per-robot layer on top of team inventory:
  tracks "In Box" (physically pulled for this robot) vs. "Inventory in stock" (team-wide) vs.
  "Qty needed" (from the BOM), with a one-click "move from inventory to box" helper and a
  dashboard "ready to assemble" indicator once In Box ≥ Qty needed. Turning it off hides but does
  not delete box counts, so a team can resume next season. *(Box mode)*
- **CAD file downloads** — single-part or bulk-by-material export in STEP, glTF, and x_t
  (Parasolid) formats, pulled live through the Onshape connection. *(3D viewer & CAD downloads;
  Site overview)*
- **Manufacturing time tracking & Analytics** — a dedicated Analytics section (added per the
  "What's new" changelog, Jul 25 2026 entry: "Analytics, Part Groups & mobile") for build-time
  metrics; specifics not deep-crawled beyond the nav listing. *(Manufacturing time & Analytics —
  title only)*
- **Inventory refinement (Aug 2026 changelog)** — "conditions, dropdowns & part pictures" (Aug 11)
  and "Inventory groups, condition & part types" (Aug 9), i.e., inventory items can now carry a
  condition field, be grouped, and show reference pictures — evidence of active, frequent
  iteration on the purchasing/inventory side specifically. *(What's new)*
- **Per-member Onshape connections** — to avoid concentrating all Onshape API traffic (and its
  rate limits) on the team owner's single account, any member can separately connect their own
  Onshape account for their own sync/download operations. *(Getting started — Step 3; Roles)*
- **Settings reference page, URL map, FAQ, and Troubleshooting** exist as dedicated reference docs
  — titles only, not deep-crawled in this pass.

Not present / not found in this outside-in pass: no attendance tracking, no scouting, no
Slack/Discord bot integration, no general team-communication features, no evidence of a public
API or webhook-out for third-party integrations (the only integration direction observed is
FRC BOM *consuming* Onshape's and FRC Orders' APIs, not exposing its own).

## Integrations

- **Onshape** — OAuth-based document/assembly linking, webhook-driven live sync, part thumbnail
  and CAD-file (STEP/glTF/x_t) fetch, and write-back part renaming for Part Numbers. Originally
  (2024) required a custom FeatureScript (`setProcesses`) and manually-generated API keys; fully
  replaced by OAuth + webhooks as of the May 2026 update, with an API-key fallback retained only
  for custom Onshape property-name mapping. [Docs] [CD]
- **FRC Orders** (`orders.frctools.com`) — third-party community vendor-parts catalog (AndyMark,
  REV, WCP, ThriftyBot, etc.); FRC BOM searches/links against it for COTS part identification,
  pricing, images, and stock status, both per-part and in bulk auto-link. [Docs] [CD]
- **Google OAuth** — sign-in identity provider for personal accounts. [Docs] [Site]
- **CSV export** — one-way output (per-vendor purchase lists); no CSV/API import path documented.
  [Docs]

## Notable Implementation Details

- **The integration model was rebuilt from scratch once already**, and the docs/CD posts document
  the "before" and "after" clearly: v1 (Dec 2024) = manual Onshape API keys + a custom
  FeatureScript (`setProcesses`) that teams had to insert into their own CAD documents to tag
  parts with process metadata; v2 (announced May 2026) = pure OAuth + Onshape's native custom
  properties (`Material`, `Process`, `Process 2`) read directly off parts, no FeatureScript
  required. This is a concrete illustration of "don't make the CAD team install your plugin"
  winning out over a more powerful-but-invasive integration approach. [CD] [Docs]
- **Storage backend evolved from a single JSON file to "a proper database"** per the author's own
  description of the rework — i.e., the original version had no real persistence layer at all
  survives only as a historical note in a CD thread, not as anything an outside observer can
  verify about the current system. [CD]
- **Ownership recovery for graduated/departed owners is a manual, unlocked "claim" path**: if an
  owner leaves without transferring ownership, the *first admin who signs in with Google* while the
  owner slot is empty can claim it from Settings — a lightweight recovery mechanism with no
  additional verification described, and an explicit "if no one has admin either, contact us"
  fallback for the fully-orphaned case. [Docs]
- **Default In-house/COTS classification is a document-identity heuristic**, not a manufacturing
  judgment call: "same Onshape document as the system's assembly ⇒ In-house, different document ⇒
  COTS." The docs note this replaced an older, weaker heuristic ("COTS = has no process assigned"),
  which is kept only as a fallback for parts with no explicit classification yet — an example of
  tightening a soft inference into an explicit, override-able field over successive releases.
  [Docs]
- **Vendor links live on the robot, not the system**, specifically so identical COTS parts reused
  across multiple subsystems (e.g., the same bearing in Drivetrain and Climber) share one FRC
  Orders link instead of needing to be relinked per system. [Docs]
- **Box Mode is deliberately non-destructive when disabled** — toggling it off only hides the
  box-count fields, it does not delete the recorded data, explicitly to let a team resume the same
  bins next season. [Docs]
- **Free-for-teams pricing funded by the project itself** (no stated sponsor/grant), with the
  README-style docs framing ("no credit card required") — no visible monetization path (no ads,
  no paid tier) found anywhere in the crawled site/docs. [Site]
- **Single-author, actively iterating solo project**: all Chief Delphi announcements (Dec 2024,
  and updates through May 2026) are posted by the same author (`DavidMasin`), and the docs' own
  "What's new" log shows near-weekly shipped changes as late as August 2026 (this survey's date),
  indicating this remains a live, actively maintained tool rather than an abandoned launch-week
  project. [CD] [Docs]

## Activity

Chief Delphi shows a continuous cadence from the Dec 17, 2024 launch thread (44 posts, 3.3k views,
67 likes) through a May 2026 major-rework announcement thread (66 posts, 4.3k views, 17 likes), and
the docs site's own "What's new" changelog lists shipped updates dated Jul 11, Jul 25, Jul 26,
Aug 9, and Aug 11, 2026 — i.e., updates landing within the last two weeks of this survey's date
(2026-08-22). This reads as an actively developed, currently-maintained hosted product, not a
dormant one. [CD] [Docs]

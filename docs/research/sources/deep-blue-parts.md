# Deep Blue Parts — Source Survey

**Repo:** DeepBlueRobotics/deep-blue-parts — https://github.com/DeepBlueRobotics/deep-blue-parts
**Surveyed-at:** ff07c174a04f55d3b448fa5d350987d75f741e88
**Permalink form:** https://github.com/DeepBlueRobotics/deep-blue-parts/blob/ff07c174a04f55d3b448fa5d350987d75f741e88/<path>
**Stack:** Ruby (Sinatra, `sinatra/base`) + Sequel ORM over MySQL; server-rendered ERB views;
Bootstrap 4 + FontAwesome vendored under `public/`; Docker/`docker-compose.yml` for deployment
(newer than upstream, which has none).
**License:** BSD 2-Clause (`COPYING`, inherited unchanged from Team 254) — permissive, safe to
treat as more than ideas-only, but note this is a **fork**, so any code lifted verbatim is still
someone else's (Team 254's) BSD-licensed work, not this team's original contribution.
**Last activity:** 2020-11-01 (`pushed_at`); most recent commit surveyed 2020-10-31. Dormant ~5
years as of survey date (2026-08-22).
**FRC team:** Team 199 (Deep Blue Robotics, per README's "Team 199 Specific Features" section and
the seed-admin account `deleteme@team199.org`).
**Areas:** purchasing/POs (vendor + COTS-parts catalog, orders), part design/manufacturing
tracking (part numbering, status pipeline, drawing/revision management).

## Purpose

Deep Blue Parts is Team 199's fork of Team 254's Cheesy Parts (see sibling survey
`docs/research/sources/cheesy-parts.md`), extended with a first-class vendor/COTS-parts catalog,
file uploads (drawings/documentation/toolpaths) with automatic revision-letter tracking, Slack and
Trello notifications on part release, per-user theming, and Docker packaging. It is the same core
idea — assign structured part numbers, track a part through a design→manufacture pipeline, manage
vendor orders and purchaser reimbursement — but meaningfully more built-out than upstream in the
purchasing/COTS and manufacturing-file areas.

## Auth & Roles

Same session/permission model as upstream Cheesy Parts, unchanged in substance:

- **Session:** `Rack::Session::Cookie`, 1-hour expiry, `session[:user_id]` (`parts_server.rb`).
- **Global gate:** `before` filter loads `@user` and calls `authenticate!` for every route except
  `/login` and `/register`; disabled users (`enabled == 0`) are logged out.
- **Local password auth:** PBKDF2-HMAC-SHA1 (1000 iterations, 24-byte hash/salt, Base64-encoded)
  via `User.authenticate` (`models/user.rb`).
- **WordPress SSO:** still present and gated by `CheesyCommon::Config.enable_wordpress_auth`
  (`parts_server.rb`), inherited from upstream — Team 254-specific, meant to be disabled by forks
  (README calls this out explicitly).
- **Self-registration:** `GET/POST /register` creates a disabled `readonly` account pending admin
  approval, same as upstream.
- **Roles** — one extra tier vs. upstream: `User::PERMISSION_MAP` = `readonly` ("Read-only"),
  **`shoptech`** ("Shop Tech"), `editor` ("Editor"), `admin` ("Administrator") (`models/user.rb`).
  Three predicates gate routes: `can_edit?` (editor/admin), **`is_shoptech?`** (shoptech/editor/
  admin — new), `can_administer?` (admin only). The new `shoptech` role is used specifically to
  gate the vendor/vendor-parts catalog (`/vendors*`, `/vendor_parts*`) and the shop-side fields on
  a part edit (quantity, notes, priority) separately from the `editor` design-side fields (name,
  uploads, mfg method, finish, revision) — a real split between "who can design a part" and "who
  can manage shop logistics for it" that upstream does not have.
- **Self-service account preferences (new vs. upstream):** `GET/POST /user/preferences` lets any
  logged-in user change their own email, name, password, and **theme** without admin involvement
  (`parts_server.rb`, `views/user_prefs.erb`) — upstream only exposes password change, admin-gated
  editing otherwise.
- **Per-user theming (new):** `THEMES` map auto-populated from every `.css` file under
  `public/themes/` (`models/user.rb`) — Cyborg, Darkly, Lux, Sandstone, Slate, Solarized Bootswatch
  themes plus "classic" — selectable in preferences and applied via `@user.theme?` checks in
  views.

## Data Model

Builds on the upstream Project/Part/User/Order/OrderItem tables (see cheesy-parts survey for
shared fields) with two new tables and one restructured one:

- **Vendor** (`models/vendor.rb`, migration `016_create_vendors.rb`) — `name`,
  `part_number_prefix`; `one_to_many :vendor_parts`; supports an uploaded `avatar.png`
  (`uploads/vendors/<id>/avatar.png`).
- **VendorPart** (`models/vendor_part.rb`, migration `017_create_vendor_parts.rb`) — a reusable
  COTS-catalog line owned by a vendor: `name`, `link` (product URL), `unit_cost`, `qty_per_unit`,
  `part_number` (vendor's own SKU). `full_part_number` composes `<vendor.part_number_prefix>-<sku>`
  — a second, independent part-numbering scheme parallel to `Part#full_part_number`.
- **Part, restructured for COTS** (migration `018_modify_parts_for_cots.rb`) — adds a `"cots"`
  value to `PART_TYPES` (alongside `part`/`assembly`) and adds `vendor_id`, `vendor_part_id`,
  `rev`, `rev_history` (comma-joined string of every revision letter ever issued), `mfg_method`,
  `finish`, `trello_link` columns not present upstream. `full_part_number` branches on type: a COTS
  part reads `Vendor[vendor_id].part_number_prefix` instead of the project prefix.
- Upstream's `source_material`/`have_material`/`cut_length` fields are gone from this fork's
  `Part`, replaced by the `mfg_method`/`finish`/`rev`/`rev_history` set — a genuine schema
  divergence, not just an addition.
- **Order/OrderItem** — same shape and Sequel associations as upstream (see that survey); no
  changes found in the read files.

## Features

### Purchasing / POs
- **Vendor directory with logo upload** — shoptechs create/edit vendors (name, part-number
  prefix, avatar image saved to `uploads/vendors/<id>/avatar.png`). `parts_server.rb` (`get/post
  "/vendors"`, `get/post "/vendors/:id/edit"`), `views/vendors.erb`, `views/vendor_edit.erb`,
  `models/vendor.rb`.
- **Reusable vendor-parts (COTS) catalog** — shoptechs register a vendor's catalog items (name,
  product link, unit cost, qty-per-unit, vendor SKU) once, independent of any project, then any
  editor can drop that item into a project as a `cots`-type part. `parts_server.rb` (`post
  "/vendor_parts"`, `get "/vendor_parts/:id"`, `get/post "/vendor_parts/:id/edit"`, `get/post
  "/vendor_parts/:id/delete"`), `views/new_vendor_part.erb`, `views/vendor_part.erb`,
  `views/vendor_part_edit.erb`, `views/vendor_part_delete.erb`, `models/vendor_part.rb`.
- **Sortable per-vendor parts list** — `get "/vendors/:id/parts"`, `views/vendor_parts.erb`,
  `views/vendor_parts_list.erb`.
- **Add a COTS part to a project from the vendor catalog** — the "new part" flow gains a `cots`
  type; picking it pre-fills part number, vendor, quantity from the chosen `VendorPart` and marks
  the new part `status = "ordered"`, `drawing_created = 1` immediately (no design/drawing step
  needed for an off-the-shelf part). `parts_server.rb` (`get "/projects/:id/new_part"` with
  `type=cots`, `post "/parts"`), `views/new_part.erb`.
- Orders/order-items/vendor-order-grouping/order stats/reimbursement reporting — same feature set
  as upstream Cheesy Parts (unchanged in the files read); see that survey for detail.

### Part design / manufacturing tracking
- **File uploads per part, versioned by revision letter** — an editor can attach a PDF
  documentation file, a PDF drawing, and a DXF toolpath file to a part. Uploading a new drawing
  auto-increments the revision letter (`increment_revision`, A→B→C…) and appends it to
  `rev_history`; files are named and stored under `uploads/<full_part_number>/{docs,drawing,
  toolpath}/`. `parts_server.rb` (`post "/parts/:id/edit"`), `models/part.rb`
  (`increment_revision`), `get "/uploads/*"` (download route, serves PDFs inline / others as
  octet-stream).
- **Manufacturing method and finish fields** — new enumerations not present upstream:
  `MFG_MAP` (Manual/Hand tools, Milled/CNC, Turned, 3D Printed, Outsourced) and `FINISH_MAP` (None,
  Powder coated, Painted, Polished), both validated server-side and editable only by
  editor/admin. `models/part.rb`.
- **Simplified 6-stage status pipeline** — narrower than upstream's ~20 stages: `designing`,
  `ordered`, `ready`, `manufacturing`, `assembly`, `done` (several upstream statuses like
  `material`/`drawing`/`welding`/`anodize`/etc. are commented out in `STATUS_MAP`, not deleted —
  easy to re-enable). `models/part.rb` (`STATUS_MAP`).
- **"Release for manufacture" workflow with drawing-readiness gate** — an editor releasing a part
  is blocked unless quantity is set and a drawing has been uploaded ("No quantity set." / "No
  drawing uploaded"); on success the part flips to `ready` and, in one action: posts a Slack
  notification to `#parts-notifications` (part number/name, parent assembly, quantity, revision)
  and creates one Trello fabrication card **per unit of quantity** with a 16-item fabrication
  checklist, then stores the resulting Trello card URLs on the part (`trello_link`).
  `parts_server.rb` (`get/post "/parts/:id/release"`), `views/part_release.erb`.
- Project/part CRUD, hierarchical assemblies, part-number generation, dashboards, delete
  confirmations — same as upstream Cheesy Parts (unchanged in the files read); see that survey.

## Integrations

- **Slack** — `slack-ruby-client` gem; bot token from `CheesyCommon::Config.slack_api_token`,
  posts a rich attachment to `#parts-notifications` when a part is released for manufacture.
  `parts_server.rb` (`before` filter initializes `$slack_bot`, `post "/parts/:id/release"`).
- **Trello** — `trello` gem; on first release of a part, creates one card per quantity unit on a
  configured board/list with a fabrication checklist, and appends each card's URL to the part's
  `trello_link` field (comma-joined, one URL per unit). `parts_server.rb`.
- **Gmail SMTP** — same `pony`/`EM.defer` pattern as upstream for account-approval and
  registration-pending mail.
- **WordPress SSO** — inherited from upstream, Team-254-specific, meant to be disabled.
- **Docker / Docker Compose** — new vs. upstream: `Dockerfile`, `Dockerfile-migrations`,
  `docker-compose.yml`, `config.json.docker` let a team stand up the app + run migrations in
  containers instead of the bare-metal/SSH deploy upstream uses.

## Notable Implementation Details

- **Two independent part-numbering schemes coexist.** In-house parts/assemblies use
  `<project prefix>-{A,P}-%04d`; COTS parts use `<vendor prefix>-<vendor SKU>` — `full_part_number`
  branches on `type == "cots"`. A re-implementer combining custom + off-the-shelf parts in one
  BOM should plan for this branch explicitly rather than assuming one numbering scheme.
  `models/part.rb`.
- **Revision history is a comma-joined string column, not a table.** `rev_history` is built by
  string concatenation (`rev_history << ",#{rev}"`) rather than a normalized revisions table —
  cheap to implement but no way to attach per-revision metadata (who, when, what changed) beyond
  the single accumulating string. `parts_server.rb` (`post "/parts/:id/edit"`).
  `# ponytail: fine for "which letters have been used" but a real re-implementation wanting
  per-revision author/timestamp/file history needs a child table, not a string column.`
- **Trello card creation loops synchronously inside `EM.defer`, one API call per unit of
  quantity.** A quantity of 20 identical parts issues ~20 Trello card creates + 20×16 checklist-
  item creates in one deferred block, with no batching, rate-limit handling, or partial-failure
  recovery — if it errors partway through, some units get cards and some don't, silently.
  `parts_server.rb` (`post "/parts/:id/release"`).
- **Vendor part-number and part.part_number reuse the same column for different meanings.**
  `Part.part_number` is normally derived numerically upstream (`Sequel.cast(:part_number,
  :unsigned)`), but for COTS parts it's overwritten with `VendorPart[params[:part_id]].part_number`
  which may be alphanumeric (a real vendor SKU) — the `generate_number_and_create` numeric-max
  logic is silently skipped for `type == "cots"` (comment: "we'll overwrite part number later so
  who cares"). Fragile if the COTS branch is ever refactored without preserving that skip.
  `models/part.rb`.
- **File upload paths are keyed by `full_part_number`, which is derived, not stored.** Renaming a
  project's `part_number_prefix` (still supported, per upstream) would silently orphan every
  already-uploaded doc/drawing/toolpath directory for that project's parts, since the directory
  name is recomputed from the current prefix at upload time but old files stay under the old path.
  This is a sharper version of an upstream gotcha (upstream has no per-part files to orphan).
  `parts_server.rb` (`post "/parts/:id/edit"`).
- **No test suite, no CI**, same as upstream. Config secrets pattern (`CheesyCommon::Config`,
  encrypted JSON values) inherited unchanged — see cheesy-parts survey's Notable Implementation
  Details for that mechanism.
- **Single surveyed commit reflects a 2018–2020 span**, not a fresh squash — normal incremental
  git history, unlike some smaller long-tail repos surveyed this round.

## Verdict

Substantive and directly relevant: a real, deployed fork of the most-imitated FRC parts-tracking
tool, meaningfully extended in exactly this project's two areas (purchasing/POs and part-
design/manufacturing tracking) beyond what the upstream cheesy-parts survey already covers. Worth
stealing: the `shoptech` role split (design permissions vs. shop-logistics permissions), the
reusable vendor/COTS-parts catalog decoupled from any one project, the drawing-upload-driven
revision-letter auto-increment, and the release-gate-plus-notification pattern (block release
until quantity+drawing exist, then fan out to Slack and per-unit Trello cards) — though the Trello
fan-out itself should be rebuilt with batching/idempotency rather than copied as-is. License is
permissive (BSD-2-Clause, unchanged from upstream), so ideas and even direct patterns are safe to
reuse with attribution norms in mind.

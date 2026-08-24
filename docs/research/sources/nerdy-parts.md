# Nerdy Parts — Source Survey

**Repo:** team2337/nerdy-parts — https://github.com/Team2337/nerdy-parts
**Surveyed-at:** 7c59b85994c0d7925817bedbd070f977ac74fe3b
**Permalink form:** https://github.com/Team2337/nerdy-parts/blob/7c59b85994c0d7925817bedbd070f977ac74fe3b/<path>
**Stack:** Ruby (Sinatra web framework, Sequel ORM), MySQL, ERB templates, Bootstrap 2 + jQuery frontend, EventMachine for async email
**License:** BSD-2-Clause (`COPYING`) — permissive, safe as an ideas/pattern reference (not copyleft). Fork of Team254/cheesy-parts, same license carried over.
**Last activity:** 2023-02-11 (pushed_at; latest commit dated 2023-02-11T21:49:47Z)
**FRC team:** Team 2337 (fork of Team 254's Cheesy Parts, rebranded/reconfigured for 2337 — see `README.md`, `config.example.json` db_user/gmail_user/base_address all reference "team2337")
**Areas:** (5) parts ordering/POs (partial — present in schema/models but routes commented out/disabled in this fork), (6) part design/manufacturing tracking (primary)

## Purpose
A lightweight internal web app that assigns sequential part/assembly numbers to CAD parts as they're designed, and tracks each part through a manufacturing status pipeline (design → material → cut → weld → coat → assemble → done) so mentors/leads can see at a glance what's ready for which shop process.

## Auth & Roles
- Local username/password auth: PBKDF2-HMAC-SHA1 password hashing with per-user salt (`models/user.rb`, 1000 iterations, 24-byte salt/hash) — dated by modern standards (bcrypt/argon2 preferred) but a working reference for a from-scratch minimal auth.
- Optional WordPress SSO integration for Team 254's own member site (`enable_wordpress_auth` config flag; `CheesyCommon::Auth.get_user` — external gem, not in this repo) — not usable as-is for another team's WordPress unless they own that specific integration; largely irrelevant to other teams and likely unused by this fork given the README's own note.
- Three-tier permission model stored on `User.permission`: `readonly`, `editor`, `admin` (`PERMISSION_MAP` in `models/user.rb`). `can_edit?` (editor+admin) and `can_administer?` (admin only) helper predicates gate routes.
- Session-based auth via `Rack::Session::Cookie` (1-hour expiry), enforced in a Sinatra `before` filter on every route except `/login` and `/register` (`parts_server.rb`).
- Public self-registration (`/register`) creates a disabled `readonly` account and e-mails an admin for approval — a simple pending-approval-by-email pattern worth reusing for lightweight team admin workflows.

## Data Model
- `Project` (`models/project.rb`) — has_many `parts`, has_many `orders`; fields include `name`, `part_number_prefix`, `hide_dashboards`.
- `Part` (`models/part.rb`) — self-referential tree via `parent_part_id` (many_to_one `parent_part` / one_to_many `child_parts`, both `class => self`), belongs to `project`. Fields: `type` (`part`|`assembly`), `part_number` (auto-incremented per parent/project scope), `status`, `name`, `notes`, `source_material`, `have_material`, `cut_length`, `quantity`, `priority`, `drawing_link`, `drawing_created`.
- `User` (`models/user.rb`) — `email`, `first_name`, `last_name`, `password`/`salt`, `permission`, `enabled`, `wordpress_user_id`.
- `Order` / `OrderItem` (`models/order.rb`, `models/order_item.rb`) — `Order` belongs to `project`, has_many `order_items`, has `vendor_name`/`status` (open/ordered/received)/`ordered_at`/`paid_for_by`/`tax_cost`/`shipping_cost`/`reimbursed`; `OrderItem` has `part_number`, `description`, `unit_cost`, `quantity`, computed `total_cost`. Present in schema (`db/migrations/012`–`013`) and models, but **all order-related Sinatra routes are commented out** in `parts_server.rb` in this fork (lines ~496–659) — the ordering/PO feature exists in the data layer only, not live in the running app.

## Features

**Part design/manufacturing tracking (area 6, primary/active):**
- Hierarchical part numbering: assemblies get numbers in increments of 100, child parts within an assembly increment from the parent's number, formatted as `<project-prefix>-<A|P>-%04d` (`models/part.rb` `generate_number_and_create`, `full_part_number`) — a scheme worth recreating for auto-generated, human-readable part IDs tied to a project prefix.
- 19-state manufacturing status pipeline defined in `Part::STATUS_MAP` (`models/part.rb`): designing → material needed → ordered → review → rough cut → drawing needed → ready to manufacture → 3D print (PLA/MarkForge split) → manufacturing → outsourced → welding → Scotch-Brite → anodize → powder coat → assembly → done → obsolete.
- Per-part priority (High/Normal/Low, `PRIORITY_MAP`) settable during edit (`views/part_edit.erb`, `POST /parts/:id/edit`).
- Part tree view within a project (assemblies expand to children) — `views/part_tree.erb`, `views/parts_list.erb`, sortable by type/name/parent/status via `?sort=` query param (`parts_server.rb` `/projects/:id`, `/parts/:id`).
- Live-refreshing shop-floor dashboard per project and per status: `GET /projects/:id/dashboard` and `/dashboard/parts` poll every 10 seconds via `setInterval(loadParts, 10000)` (`views/dashboard.erb`) with a client-side status filter dropdown — a simple pattern for a shop-floor status board without websockets.
- Cross-project "all dashboards" index (`views/dashboards.erb`, `GET /dashboards`), with a per-project `hide_dashboards` flag to exclude a project from it.
- Part metadata tracked per part: source material, "have material" checkbox, cut length, quantity, drawing link + auto-derived "drawing created" flag (set true the moment a non-empty drawing link is saved — `POST /parts/:id/edit`), free-text notes.
- Part/assembly CRUD with guardrail: an assembly with existing children cannot be deleted (`POST /parts/:id/delete` checks `@part.child_parts.empty?`).
- Project CRUD (name + part-number prefix), admin-only create/edit/delete (`views/new_project.erb`, `project_edit.erb`, `project_delete.erb`).

**Parts ordering/POs (area 5, present but disabled in this fork):**
- Data model and views exist for vendor-grouped purchase orders: order items collected per-vendor into an "open" order, transitioned open → ordered → received (`Order::STATUS_MAP`), with tax/shipping cost fields and a "reimbursed" flag for tracking who paid and whether they were repaid (`models/order.rb`, `views/order.erb`, `open_orders.erb`, `completed_orders.erb`, `order_stats.erb`).
- An order-stats view groups spend by vendor and by purchaser, splitting each purchaser's total into reimbursed vs. outstanding (commented-out route in `parts_server.rb`, logic still visible) — a useful pattern for a reimbursement-tracking report even though not wired up here.
- All of the above is inert in this specific fork (routes commented out) — worth noting as "recreate only if the team actually wants POs," since this team apparently decided not to use that half of upstream Cheesy Parts.

## Integrations
- Gmail SMTP (via the `pony` gem) for two transactional emails: new-user pending-approval notice to the admin, and an account-approved notice to the new user (`parts_server.rb` `send_email`, dispatched async via EventMachine so the request isn't blocked).
- Optional WordPress-based SSO (`CheesyCommon::Auth`/`CheesyCommon::Config`, from an external `cheesy-common` gem not vendored in this repo) — team-254-specific, not portable.
- No Slack/Discord/Onshape/TBA integration present.

## Notable Implementation Details
- This is a near-verbatim fork of Team254's Cheesy Parts (same file layout, same class names `CheesyParts::Server`, same copyright headers "Team 254. All Rights Reserved." throughout) with team-specific config values (`config.example.json`) and the ordering feature turned off. Confirms this as a "long-tail, low-differentiation" entry as flagged — most of its value for this survey is Cheesy Parts' own design (part numbering scheme, status pipeline, live dashboard polling), which the parent repo already documents; this fork adds no unique features beyond disabling ordering.
- Deployment is git-pull-based (`deploy` script, described in README): SSH to prod, discard local changes, `git pull`, restart — a minimal/legacy deploy pattern, not containerized.
- Password hashing (PBKDF2-HMAC-SHA1, 1000 iterations) is weak by 2020s standards; if recreating auth, use bcrypt/argon2/scrypt with modern iteration counts instead of copying this scheme.
- HTML-escaping is done ad hoc via `.gsub("\"", "&quot;")` on individual string fields rather than templating-engine auto-escaping — a fragile, easy-to-miss XSS-prevention anti-pattern to avoid; use ERB's `<%=` auto-escape or a real sanitizer instead.
- Ruby 2.3 / Sinatra / Sequel / MySQL stack from ~2013–2018 vintage; no test suite, no CI config, no Docker in the tree — a small monolith meant to run directly on a single Ubuntu box.

## Verdict
Thin/marginal as a standalone source: it is a faithful, low-differentiation fork of the already-known Cheesy Parts (Team254) with the PO/ordering feature disabled and no new functionality added. Worth stealing: the part-numbering scheme (assembly-number-block + child-increment), the 19-stage manufacturing status pipeline, and the 10-second-poll live shop dashboard — but these are better sourced from upstream Cheesy Parts itself, which still has ordering live and is more actively maintained.

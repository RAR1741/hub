# cheesy-parts — Source Survey

**Repo:** https://github.com/Team254/cheesy-parts (FRC 254)
**Surveyed at commit:** `034ef59a064e2d3b8fb1268ca8b990195cbbb271`
**File links:** paths below are relative to repo root; permalink form is
`https://github.com/Team254/cheesy-parts/blob/034ef59a064e2d3b8fb1268ca8b990195cbbb271/<path>`

## Purpose

Cheesy Parts is a web-based part-tracking system built by FRC Team 254 for managing parts through the design and manufacture cycle of a robot build season. It assigns structured part numbers (so CAD files can be checked into version control under a canonical name), tracks each part's manufacturing status through a ~20-stage pipeline, groups parts into hierarchical assemblies within projects (e.g. one robot per project), and manages vendor purchasing — order items, orders, costs, purchaser reimbursement, and spend statistics. Its users are robotics-team members: designers creating parts and updating status, machinists/manufacturing leads watching the shop dashboard for what's ready to cut, purchasers placing and reconciling vendor orders, and administrators approving accounts and setting permissions.

## Stack

- **Language:** Ruby. `.ruby-version` pins `2.7.1`; `README.md` still documents Ruby 1.9.3-p286 (the two disagree).
- **Framework:** Sinatra (`sinatra/base`, modular `CheesyParts::Server < Sinatra::Base` in `parts_server.rb`), served by Thin, daemonized with the `daemons` gem (`parts_server_control.rb`).
- **Database:** MySQL via `mysql2`, accessed through the Sequel ORM (`db.rb`, `models.rb`, `models/*.rb`). Schema managed by Sequel migrations in `db/migrations/`, run by a Rake task (`Rakefile`, `rake db:migrate`).
- **Key libraries:** `sequel`, `sinatra`, `thin`, `mysql2`, `daemons`, `pony` (SMTP mail), `eventmachine` (async mail dispatch), `activesupport` (time), `dedent`, `pathological` (load-path management, `Pathfile`), `httparty`, and `cheesy-common` — a Team 254 gem pulled from GitHub that supplies `CheesyCommon::Config` (JSON config + encrypted-value decryption via `aescrypt`) and `CheesyCommon::Auth` (WordPress SSO). See `Gemfile`, `Gemfile.lock`.
- **Frontend:** Server-rendered ERB views (`views/*.erb`) with a hand-rolled `header.erb`/`footer.erb` include pattern rather than a Sinatra layout. Vendored Bootstrap 2 + jQuery 1.8.3 + bootstrap-datepicker under `public/`. Progressive enhancement via jQuery AJAX in `public/js/js.js` and inline scripts (dashboard polling, inline status editing, inline order-item editing, vendor typeahead). Custom styling in `public/css/css.css` (per-status label colors, priority colors).
- **License:** BSD 2-Clause, Copyright (c) 2013 Team 254 — in `COPYING` (there is no `LICENSE` file).
- **Deployment/hosting:** Self-hosted, no Docker and no Heroku. `deploy` is a bash script that SSHes to a fixed host (`team254@ec2.team254.com`), and in `/opt/sites/cheesy-parts` runs `git checkout -f && git pull && bundle install && bundle exec rake db:migrate && bundle exec ruby parts_server_control.rb restart`. The server process is managed by `parts_server_control.rb` (`start`/`stop`/`run`/`restart`) with `Daemons.run_proc(..., :monitor => true)` for automatic restart on crash, binding Thin to `0.0.0.0` on the configured port. Config lives in `config.json` with `global`/`dev`/`prod` sections.

## Auth & Roles

- **Session:** `Rack::Session::Cookie` with a 1-hour expiry (`parts_server.rb`). The logged-in user id is stored in `session[:user_id]`.
- **Global gate:** a Sinatra `before` filter loads `@user` and calls `authenticate!` for every route except `/login` and `/register`; unauthenticated requests redirect to `/login?redirect=<path>`. A user whose `enabled` flag is 0 is logged out and bounced to `/login?disabled=1`.
- **Local password login:** `POST /login` against `User.authenticate` (`models/user.rb`), which compares a PBKDF2-HMAC-SHA1 hash (1000 iterations, 24-byte hash, 24-byte per-user random salt, Base64-encoded) against the stored password.
- **WordPress SSO:** when `enable_wordpress_auth` is true in `config.json`, `GET /login` calls `CheesyCommon::Auth.get_user(request)` and redirects to `members_url?site=parts&path=...` if no member session exists. A member with no local row is auto-provisioned as a `User` with `permission => "editor"`, `enabled => 1`, blank password/salt, and a stored `wordpress_user_id`. `/logout` redirects to the members-site logout in this mode. Users with a `wordpress_user_id` do not see the Change Password link (`views/header.erb`).
- **Self-registration:** `GET/POST /register` creates an account with `permission => "readonly"` and `enabled => 0`, pending admin approval.
- **Roles** (`User::PERMISSION_MAP` in `models/user.rb`): `readonly` ("Read-only"), `editor` ("Editor"), `admin` ("Administrator"). Enforced by two predicates — `can_edit?` (editor or admin) and `can_administer?` (admin only) — checked via `require_permission`, which halts 400 with "Insufficient permissions." Read-only users can view everything (projects, parts, dashboards, orders, stats) but every create/edit/delete route and every action button is gated; `/users`, `/new_user`, and user edit/delete are admin-only. An `enabled` boolean acts as an orthogonal account-active flag.
- **Seed account:** migration `db/migrations/011_add_starting_user.rb` inserts admin `deleteme@team254.com` / `chezypofs`, which the README instructs you to delete after making your own admin.

## Data Model

- **Project** (`models/project.rb`, `db/migrations/002`, `008`, `014`) — `name` (unique), `part_number_prefix` (string, unique), `hide_dashboards` flag. `one_to_many :parts`, `one_to_many :orders`.
- **Part** (`models/part.rb`, `db/migrations/001`, `004`, `005`, `009`) — belongs to a Project; self-referential tree via `parent_part_id` (`many_to_one :parent_part`, `one_to_many :child_parts`, with `0` used as the "no parent" sentinel). Fields: `part_number` (integer, unique per project after migration 009), `type` (`part` or `assembly`), `name` (displayed as "Description"), `notes`, `status`, `source_material`, `have_material` (0/1), `quantity`, `cut_length`, `priority` (0/1/2), `drawing_created` (0/1).
- **User** (`models/user.rb`, `db/migrations/003`, `006`, `007`, `010`) — `email` (unique), `password`, `salt`, `permission`, `first_name`, `last_name`, `enabled`, `wordpress_user_id` (unique, nullable).
- **Order** (`models/order.rb`, `db/migrations/012`, `015`) — belongs to a Project, `one_to_many :order_items`. Fields: `vendor_name`, `status` (`open`/`ordered`/`received`), `ordered_at`, `paid_for_by`, `tax_cost`, `shipping_cost`, `notes`, `reimbursed`. Computes `subtotal` (sum of item totals) and `total_cost` (subtotal + tax + shipping).
- **OrderItem** (`models/order_item.rb`, `db/migrations/013`) — `many_to_one :order` (nullable — items with no vendor are "unclassified"), `many_to_one :project`. Fields: `quantity`, `part_number` (free-text vendor part number, not a Cheesy part), `description`, `unit_cost`, `notes`; computes `total_cost = unit_cost * quantity`.

Note: relationships are application-level Sequel associations; the migrations define no foreign-key constraints, and deletes are not cascading (guarded in the routes instead).

## Features

- **Project list** — Landing page (`/` redirects to `/projects`) listing every project as a link. `parts_server.rb` (`get "/projects"`), `views/projects.erb`.
- **Create project** — Editors create a project with a name and a part-number prefix. `parts_server.rb` (`get "/new_project"`, `post "/projects"`), `views/new_project.erb`, `models/project.rb`.
- **Edit project** — Rename a project or change its part-number prefix (which retroactively changes the displayed full part numbers of all its parts). `parts_server.rb` (`get/post "/projects/:id/edit"`), `views/project_edit.erb`.
- **Delete project** — Editors delete a project after a confirmation page. `parts_server.rb` (`get/post "/projects/:id/delete"`), `views/project_delete.erb`.
- **Project part list with column sorting** — All parts and assemblies for a project in a table (part number, type, description, parent, status, actions); clicking a column header re-sorts via `?sort=id|type|name|parent_part_id|status`. `parts_server.rb` (`get "/projects/:id"`), `views/project.erb`, `views/parts_list.erb`.
- **Create part / create assembly with automatic part numbering** — Editors add a part or assembly, optionally choosing a parent assembly. Numbers assigned automatically: assemblies get the project's max assembly number + 100 (starting at 0), parts get the max sibling part number under that parent + 1 (seeded from the parent assembly's number). `parts_server.rb` (`get "/projects/:id/new_part"`, `post "/parts"`), `models/part.rb` (`generate_number_and_create`), `views/new_part.erb`.
- **Formatted full part numbers** — Canonical numbers like `PREFIX-A-0100` / `PREFIX-P-0101` combining project prefix, type letter (A/P), and zero-padded number, intended as the CAD filename. `models/part.rb` (`full_part_number`), used across `views/parts_list.erb`, `views/part.erb`, `views/dashboard_parts.erb`.
- **Part detail page** — Full attribute table for one part: project, full part number, description, status, notes, and — for parts, not assemblies — source material, have-material, cut length, quantity, drawing-created, priority. `parts_server.rb` (`get "/parts/:id"`), `views/part.erb`.
- **Assembly hierarchy / breadcrumb tree** — An assembly's page lists its contained parts and sub-assemblies (sortable), and every part shows a recursive breadcrumb chain up through its ancestor assemblies to the project. `views/part.erb`, `views/part_tree.erb`, `views/parts_list.erb`.
- **Edit part** — Change name, status, notes, source material, have-material, cut length, quantity, drawing-created, priority. Returns to the referring page via a hidden `referrer` field. `parts_server.rb` (`get/post "/parts/:id/edit"`), `views/part_edit.erb`.
- **Part status lifecycle** — 20 statuses covering the design-to-done pipeline: designing, material (needs ordering), ordered (waiting for materials), drawing, ready, cnc, laser, lathe, mill, printer, router, manufacturing, outsourced, welding, scotchbrite, anodize, powder, coating, assembly, done — each with its own color-coded label. `models/part.rb` (`STATUS_MAP`), `public/css/css.css`, rendered in `views/parts_list.erb`, `views/part.erb`, `views/part_edit.erb`, `views/dashboard_parts.erb`.
- **Inline AJAX status change from a list** — Clicking a part's status label swaps it for a dropdown; confirming POSTs to `/parts/:id/edit` with `redirect=false` and updates the label in place without a reload. `views/parts_list.erb` (`editPart`), `parts_server.rb` (`post "/parts/:id/edit"`).
- **Part priority** — Three levels (High/Normal/Low), used to order parts within a dashboard status column and color the tiles. `models/part.rb` (`PRIORITY_MAP`), `views/part_edit.erb`, `views/dashboard_parts.erb`, `public/css/css.css`.
- **Delete part** — Confirmation-gated; an assembly with children is refused ("Can't delete assembly with existing children."). `parts_server.rb` (`get/post "/parts/:id/delete"`), `views/part_delete.erb`.
- **Shop dashboards index** — Lists projects with dashboards enabled, linking to each project's "Parts in progress" board. `parts_server.rb` (`get "/dashboards"`), `views/dashboards.erb`.
- **Live project dashboard** — Kanban-style board grouping parts into one row per status (skipping empty statuses, hiding "done" by default), ordered by priority, each part a clickable tile with a hover tooltip; auto-refreshes every 10 seconds. `parts_server.rb` (`get "/projects/:id/dashboard"`, `get "/projects/:id/dashboard/parts"`), `views/dashboard.erb`, `views/dashboard_parts.erb`, `public/js/js.js` (`loadParts`).
- **Dashboard status filter** — Dropdown narrows the dashboard to one status; the choice survives the 10-second auto-refresh. `views/dashboard.erb`, `public/js/js.js` (`changeDashboardFilter`).
- **Orders index by project** — Per non-hidden project: links to Open orders, Placed orders, Received orders, and Order totals/statistics. `parts_server.rb` (`get "/orders"`), `views/orders_project_list.erb`.
- **Open orders view with unclassified items** — All order items with no vendor in an "Unclassified items" table, then each open vendor order grouped under its vendor name, date, status label. `parts_server.rb` (`get "/projects/:id/orders/open"`), `views/open_orders.erb`, `views/order_items_list.erb`.
- **Add order item (auto-grouping into vendor orders)** — Inline new-item row (vendor, quantity, part number, description, unit cost, notes); typing a vendor finds that project's existing open order for that vendor or creates one; blank vendor leaves the item unclassified. `parts_server.rb` (`post "/projects/:id/order_items"`), `views/new_order_item.erb`, `views/open_orders.erb`.
- **Vendor name autocomplete** — Typeahead sourced from the distinct set of all existing order vendor names, injected as a JS array in the page header. `views/header.erb`, `public/js/js.js` (`vendorAutoComplete`).
- **Inline AJAX order-item editing** — Edit button swaps a table row for an editable row fetched from the server; saving can move the item to a different vendor's open order (finding or creating it). `parts_server.rb` (`get "/projects/:project_id/order_items/:id/editable"`, `post "/projects/:project_id/order_items/edit"`), `views/edit_order_item.erb`, `public/js/js.js` (`editOrderItem`).
- **Delete order item** — Confirmation page, returns to referring page. `parts_server.rb` (`get/post "/projects/:project_id/order_items/:id/delete"`), `views/order_item_delete.erb`.
- **Order detail and editing** — Line-item table plus form for status, tax, shipping, "paid for by", reimbursed checkbox, date ordered (datepicker), notes; subtotal/total computed read-only. Read-only users see the form fully disabled. Dollar signs stripped from currency input. `parts_server.rb` (`get "/projects/:id/orders/:order_id"`, `post "/projects/:id/orders/:order_id/edit"`), `views/order.erb`, `models/order.rb`.
- **Order status lifecycle** — Open → Ordered → Received with color-coded labels and per-status list views. `models/order.rb` (`STATUS_MAP`), `parts_server.rb`, `views/completed_orders.erb`.
- **Placed and received order views** — Read-only lists of a project's `ordered`/`received` orders with purchaser/subtotal/tax/shipping/total footers, sorted by vendor then date. `parts_server.rb` (`get "/projects/:id/orders/ordered"`, `get "/projects/:id/orders/complete"`), `views/completed_orders.erb`.
- **All-orders view with filtering** — Every order for a project, optionally filtered by `?filter=column:value` (used for vendor and purchaser drill-downs from stats). `parts_server.rb` (`get "/projects/:id/orders/all"`), `views/completed_orders.erb`.
- **Order statistics report — by vendor** — For all non-open orders: per-vendor order count, item count, total spent, tax, shipping, plus grand total; vendors link into the filtered all-orders view. `parts_server.rb` (`get "/projects/:id/orders/stats"`), `views/order_stats.erb`.
- **Reimbursement report — by purchaser** — Per "paid for by" person: reimbursed vs. outstanding vs. total, driven by each order's `reimbursed` flag. `parts_server.rb` (`get "/projects/:id/orders/stats"`), `views/order_stats.erb`.
- **Delete order** — Confirmation-gated; refuses non-empty orders. `parts_server.rb` (`get/post "/projects/:id/orders/:order_id/delete"`), `views/order_delete.erb`.
- **Admin user management console** — Active and Disabled/Pending users listed separately (email, name, permission) with edit/delete. `parts_server.rb` (`get "/users"`), `views/users.erb`.
- **Admin create user** — Email, name, password, permission level, enabled checkbox, with server-side validation. `parts_server.rb` (`get "/new_user"`, `post "/users"`), `views/new_user.erb`.
- **Admin edit user / approve account** — Change email, name, password, permission, enabled; flipping disabled→enabled triggers an "Account approved" email. `parts_server.rb` (`get/post "/users/:id/edit"`), `views/user_edit.erb`.
- **Admin delete user** — Confirmation-gated. `parts_server.rb` (`get/post "/users/:id/delete"`), `views/user_delete.erb`.
- **Self-registration with admin approval** — `/register` creates a read-only disabled account, emails the admin inbox, and shows a "you'll be emailed when approved" page. `parts_server.rb` (`get/post "/register"`), `views/new_user.erb`, `views/register_confirmation.erb`.
- **Login / logout** — Password form with error banners, `redirect` param preserving the requested path, SSO button when WordPress auth is enabled. `parts_server.rb` (`get/post "/login"`, `get "/logout"`), `views/login.erb`.
- **Change own password** — After verifying the old one; hidden for SSO users. `parts_server.rb` (`get/post "/change_password"`), `views/change_password.erb`.
- **Client-side password confirmation** — "Verify Password" match check on all three password forms. `public/js/js.js` (`verifyPasswordMatch`).
- **Double-click to select text** — Table cells marked `selectable` select their whole contents on double-click, for copying part numbers into CAD. `public/js/js.js` (`selectText`).
- **Role-aware navigation** — Projects always; Dashboards and Orders unless `hide_unused_fields`; Users only for admins. `views/header.erb`.
- **Simplified-mode field hiding** — `hide_unused_fields` config flag strips the app down to part numbering only (hides status/material/quantity/drawing/priority and the Dashboards/Orders nav). `config.json`, `views/header.erb`, `views/parts_list.erb`, `views/part.erb`, `views/part_edit.erb`.
- **Per-project dashboard/order hiding** — `hide_dashboards` column omits a project from the Dashboards and Orders indexes (useful for archived seasons); set at creation, no UI toggle. `db/migrations/014`, `views/dashboards.erb`, `views/orders_project_list.erb`.
- **Auto-focus on forms** — First visible enabled text field focused on load. `public/js/js.js`.

Not present: no CSV/spreadsheet export, no API endpoint, no attachment/file upload, no audit log, no full-text search.

## Integrations

- **Gmail SMTP (outbound email)** — All notification mail through `smtp.gmail.com:587` STARTTLS using `gmail_user`/`gmail_password` from config. Two messages: registration-pending (to the admin inbox) and account-approved (to the user). `parts_server.rb` (`send_email`), `config.json`, `Gemfile` (`pony`).
- **Team 254 WordPress members site (SSO)** — Optional; identity via `CheesyCommon::Auth.get_user`, local rows keyed by `wordpress_user_id`. README notes it is Team 254-specific and should be disabled by other teams. `parts_server.rb`, `db/migrations/010`, `config.json`.
- **`cheesy-common` gem** — Config loading with AES-encrypted values, auth. `Gemfile`, `db.rb`, `parts_server.rb`.
- **Team 254 media CDN** — favicon from `media.team254.com`. `views/header.erb`.
- **Production server over SSH** — deploy script targets `ec2.team254.com`; no CI. `deploy`.

## Notable Implementation Details

- **Part-number allocation scheme.** `Part.generate_number_and_create` computes numbers with two `MAX()` queries: assemblies take project-wide max assembly number + 100 (first is 0), parts take max sibling number under the same parent (seeded from the parent's number) + 1 — so assembly 100 owns parts 101, 102, … Not transactional; concurrent creates race, guarded only by the `(project_id, part_number)` unique constraint (migration 009). Renumbering never happens: `full_part_number` derives at render time, so editing a project prefix silently renames every part.
- **`parent_part_id = 0` sentinel.** Top-level parts store `0` rather than NULL for "no parent". Any rewrite using a nullable FK must translate this.
- **Asynchronous email via EventMachine.** `send_email` wraps `Pony.mail` in `EM.defer` (works because Thin is EventMachine-based); no job queue, no retry, no delivery logging — a failed send is silently lost.
- **`URL` constant in email bodies.** Both email templates interpolate a bare `URL` constant not defined in this repo (`parts_server.rb:341`, `parts_server.rb:404`); config carries `base_address` instead. A re-implementer should wire these to the configured base address explicitly.
- **Encrypted config values.** Production secrets in committed `config.json` are `Encrypted:<base64>` strings decrypted by `CheesyCommon::Config` (AES via `aescrypt`); config merges `global` with `dev`/`prod` overrides.
- **Process supervision.** `Daemons.run_proc("parts_server", :monitor => true)` forks a monitor that restarts the server on crash; Thin binds `0.0.0.0` directly, TLS assumed external.
- **Migration seeds data through the model layer.** Migration 011 requires `models/user.rb` and calls `set_password` — migrations depend on app code.
- **Polling rather than push for the dashboard.** 10-second `setInterval` re-fetches the whole board partial; the partial issues one query per status (20 queries per refresh per viewer). Status keys double as CSS class suffixes.
- **Partial-rendering conventions.** Views include `erb :header`/`erb :footer` inline; partials receive data via `:locals` but several read instance variables directly, coupling them to callers. `views/part_tree.erb` recurses to build the breadcrumb.
- **Vendor list injected globally.** `views/header.erb` runs `Order.all.map(&:vendor_name).to_set` on every page render — every page load scans the orders table.
- **Referrer round-tripping for return navigation.** Edit/delete flows stash `request.referrer` in a hidden field and redirect to it, with a special case avoiding a just-deleted part's page.
- **Input handling quirks.** Part names get `"` replaced with `&quot;` at write time rather than render-time escaping; currency inputs cleaned with `.gsub(/\$/, "")`; order-item fields escaped only in the inline-edit partial; `/projects/:id/orders/all` passes user-supplied `filter=column:value` straight into a Sequel `filter` on a symbolized column.
- **Delete integrity enforced in routes, not schema.** No FKs or cascades; the app refuses to delete assemblies with children and non-empty orders, but deleting a project orphans its parts, orders, and items.
- **No test suite, no CI, no Docker.** `Rakefile` defines only `db:migrate`; single squashed commit, so history offers no context.

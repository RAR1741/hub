# TeamManager (mlavrent/TeamManager) — Source Survey

**Repo:** mlavrent/TeamManager — https://github.com/mlavrent/TeamManager
**Surveyed-at:** cbddb49fb831c7c749253a017353fd04baebe4e4
**Permalink form:** https://github.com/mlavrent/TeamManager/blob/cbddb49fb831c7c749253a017353fd04baebe4e4/<path>
**Stack:** Python/Django (2.x era), PostgreSQL (uses `django.contrib.postgres.search`), server-rendered templates, vanilla JS + Chart.js-style JSON for charts, deployed on Heroku
**License:** MIT (LICENSE file present, copyright Mark Lavrentyev, 2019) — safe to draw ideas from freely, no copyleft concerns
**Last activity:** 2024-04-16 (pushed_at); last real commit surveyed is cbddb49f (repo otherwise dormant since ~2020 based on updated_at)
**FRC team:** Unclear/ambiguous — GitHub repo topics tag it `frc`, and the configured `EMAIL_HOST_USER` is `mercytechtigers3654@outlook.com` (suggesting FRC team "Mercy Tech Tigers"), but `settings.py` has example values `TEAM_NAME = "Brown FSAE"` (a Formula SAE team, not FRC) — likely leftover/demo config rather than the deploying team's real identity. Treat as a generic team-ops tool usable by any student team, FRC-adjacent.
**Areas:** (5) parts ordering/POs. Also lightly touches (2) people/rosters via basic account signup/roles, but there is no roster feature beyond Django's built-in User/Group.

## Purpose
A single-purpose Django app that replaces an ad-hoc "email the mentor a link" purchase-request process with a tracked workflow: a member submits a purchase request, an "Approvers" group reviews and approves/denies it, a "Purchasers" group marks it ordered (with shipping cost) and later delivered, and email notifications fire at each request-creation step. Includes a spending/activity dashboard and CSV export for treasurers.

## Auth & Roles
- Django's built-in auth (`django.contrib.auth`) plus a custom `accounts` app for self-service signup with **email activation** (`accounts/views.py::signup`, `activate`; token via `accounts/tokens.py` using `PasswordResetTokenGenerator` subclass `account_activation_token`). New users are created `is_active=False` until they click the emailed activation link.
- Login is class-based (`accounts/views.py::LoginView`), themed via context (`theme_color`, `team_name`).
- **Roles are plain Django Groups**, checked ad hoc in views rather than a formal RBAC layer:
  - `"Approvers"` group — can approve/deny/undo a request (`purchaseRequests/views.py::detail`, checks `request.user.groups.filter(name="Approvers").exists()`).
  - `"Purchasers"` group — can mark a request ordered (enter shipping cost) or delivered.
  - `"Email Viewers"` group — no functional permission, just an extra recipient list for new-request notification emails (cc-only role).
  - No group = can only submit and view requests, and edit/delete own pending (unapproved) requests.
- Permission enforcement is entirely inside view functions (string checks on POST field names + group membership), not Django's permission framework — a re-implementer should upgrade this to real permission classes/decorators rather than copy the pattern verbatim.

## Data Model
Two apps, one core model:
- **`purchaseRequests.Request`** (`purchaseRequests/models.py`) — the whole PO lifecycle in one table:
  - Request fields: `timestamp`, `author` (FK User), `item`, `cost`, `quantity`, `link` (URL), `supplier` (auto-derived from the link's domain via `tldextract` if not given), `notes`.
  - Approval fields: `approved` (nullable tri-state bool: None=pending, True/False), `approved_timestamp`, `approver` (FK User).
  - Order/purchase fields: `ordered` (bool), `order_timestamp`, `orderer` (FK User), `shipping_cost`.
  - Delivery fields: `delivered` (bool), `delivery_timestamp`, `delivery_person` (FK User).
  - Computed `line_total()` = quantity × cost (+ shipping_cost if present).
  - All actor FKs use `on_delete=SET_NULL` so history survives user deletion.
  - 12 migrations show organic schema growth (author added later, shipping_cost and supplier added later) — a realistic incremental history to learn from.
- **`accounts`** app has no models of its own — reuses Django's `User`/`Group`.

## Features

### Parts ordering / POs (primary area)
- **Submit a purchase request** — `purchaseRequests/views.py::new_request`, form at `purchaseRequests/templates/purchaseRequests/new_request.html`: item name, cost, quantity, link, notes.
- **Auto-detect supplier from link domain** — `purchaseRequests/models.py::Request.save()` uses `tldextract` to fill `supplier` from the URL if not explicitly set.
- **Approve / deny / reset-to-pending** — `purchaseRequests/views.py::detail`, POST handlers for `den-but` / `app-but` / `und-but`, gated on `"Approvers"` group membership; records approver + timestamp.
- **Mark as ordered with shipping cost** — same view, `"shipping"` POST field, gated on `"Purchasers"` group; records orderer + timestamp + shipping cost.
- **Mark as delivered** — `"delivered"` POST field, same purchaser gate; records delivery person + timestamp.
- **Edit a pending request** — `purchaseRequests/views.py::edit`; only the original author (or a superuser) can edit, and only while `approved is None` (locks the request once a decision is made).
- **Delete a request** — `purchaseRequests/views.py::delete_request`.
- **List view with filters and search** — `purchaseRequests/views.py::list` + `list.html`: date-range filter, status filter (denied/undecided/approved-not-ordered/ordered-not-delivered/delivered) via checkboxes, and a query-string mini search language (`user:<name>`, `supp:`/`supplier:<name>`, bare terms = full-text search on item name using Postgres `SearchVector`).
- **CSV export** — `purchaseRequests/views.py::export`: dumps every request with all actor names and timestamps for offline/treasurer use.
- **Spending/activity summary dashboard** — `purchaseRequests/views.py::summary` + `summary.html`/`summary_chart.js`/`summary_range.js`: auto-selects a bucket granularity (hour/day/week/month/year) based on the selected date range, and renders two time series (request-activity counts and approved spending $) plus aggregate totals (team-wide and per-current-user: request count, approved count, total requested $, total approved $). Custom date-range picker (`calendar.js`) recomputes bins client/server-side.
- **Email notification on new request** — `purchaseRequests/views.py::new_request` sends both plaintext and HTML email (templates in `purchaseRequests/email_config.py`, using old-style `%`-formatted strings) to everyone in `"Approvers"` and `"Email Viewers"` groups, with a direct link back to the request detail page.

### People/rosters (thin)
- Self-service signup with email verification (`accounts/forms.py::SignUpForm` extends `UserCreationForm` with email/first/last name) — not a roster, just account creation.
- No attendance, no member profile fields beyond Django's stock User model, no roster listing UI.

## Integrations
- **Email (SMTP)** — Django's `send_mail`, configured for Outlook/Office365 SMTP (`EMAIL_HOST = 'smtp-mail.outlook.com'`) in `team_manager/settings.py`; used for both account activation and new-purchase-request notifications. No Slack/Discord/SMS/Onshape/TBA integration of any kind.

## Notable Implementation Details
- **Tri-state boolean via `NullBooleanField`** for approval status (pending/approved/denied) is a clean, reusable pattern for review workflows — simpler than a separate status enum for this 3-state case.
- **Supplier auto-fill from URL domain** using `tldextract` is a nice small UX touch (no manual supplier entry needed for common vendor links) worth stealing directly.
- **Status transitions are unguarded state machine logic in the view** — nothing stops "delivered" being set before "ordered", or repeated approve/deny toggling; there's no audit log of status changes, only the latest actor+timestamp per stage (overwritten on each transition). A re-implementer wanting a real audit trail needs a separate status-history table.
- **Group-name string checks scattered across views** instead of centralized permission decorators — copy the role concept (Approvers/Purchasers/Email-Viewers-as-cc-list), not the enforcement mechanism.
- **`summary` view's binning logic is a long hand-rolled date-bucketing algorithm** (hour/day/week/month/year cutoffs with manual `relativedelta` math) — functionally useful reference for "auto-granularity" time-series charts, but written pre-modern-library conventions (mutable reassignment of `start_time`/`end_time` types across branches); a re-implementation should use a maintained date-bucketing library instead of porting this code.
- Legacy Django idioms throughout (`NullBooleanField` is deprecated in modern Django, `force_text` renamed to `force_str`, Heroku/Procfile deploy target, no API layer/DRF, no tests of substance beyond stub `tests.py` files) — treat as a UX/feature reference only, not a code base to fork.
- Scale: single-table workflow, no pagination visible in `list` view — fine for a season's worth of requests (dozens–low hundreds) but would need pagination for years of accumulated history.

## Verdict
Substantive and directly relevant for the parts-ordering/PO area: a complete, if small, request → approve → order → deliver workflow with role gating, email notifications, supplier auto-detection, CSV export, and an auto-binned spending dashboard. Worth stealing: the tri-state approval field, supplier-from-URL auto-fill, the Approvers/Purchasers/Email-Viewers role split, and the CSV export field list — not worth stealing the permission-enforcement style or the hand-rolled date-binning algorithm.

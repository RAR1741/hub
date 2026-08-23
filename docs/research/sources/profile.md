# thelab-ms/profile — Source Survey

**Repo:** thelab-ms/profile — https://github.com/thelab-ms/profile
**Surveyed-at:** 4a6ce0568def36040453aa1911759446b548e5ed (get via: gh api repos/thelab-ms/profile/commits --jq '.[0].sha')
**Permalink form:** https://github.com/thelab-ms/profile/blob/4a6ce0568def36040453aa1911759446b548e5ed/<path>
**Stack:** Go (stdlib `net/http`, no framework), server-rendered `html/template`, Keycloak as the identity/user store (no SQL member table), Postgres only for an events/reporting sink, vendored dependencies (`vendor/`)
**License:** MIT (`LICENSE` present) — safe to look at for ideas/patterns, standard MIT terms apply if code were ever reused verbatim (we don't)
**Last activity:** 2025-02-23 (`pushed_at`)
**FRC team:** unknown / not applicable — this is a makerspace (hackerspace), not an FRC team. Comparable-org label per task instructions: **not FRC, makerspace org**.
**Areas:** people/rosters (primary); communication (secondary — signup emails, Discord); third-party integrations (Stripe, PayPal, Keycloak, Discord, Docuseal, Conway)

## Purpose
Runs membership/identity for a hackerspace ("TheLab"): self-service signup, waiver signing, dues payment (Stripe subscriptions, with legacy PayPal migration), building-access keyfob assignment, and Discord role sync — all driven off Keycloak as the system of record for member attributes, with background jobs that reconcile payment and visit-swipe state.

## Auth & Roles
- End-user auth is handled entirely upstream by an oauth2-proxy sidecar (not in this repo): handlers read identity off `X-Forwarded-Preferred-Username`, `X-Forwarded-Email`, and `X-Forwarded-Groups` request headers (`internal/server/router.go`, `getUserID`).
- Role model is a single flag: membership in the `leadership` group (checked via a `strings.Contains(r.Header.Get("X-Forwarded-Groups"), "leadership")` middleware, `onlyLeadership` in `internal/server/router.go`). No finer-grained roles/permissions exist.
- Leadership-only routes: `/admin/dump` (CSV export) and `/admin/assign-fob` (`internal/server/handlers_admin.go`).
- Keycloak itself is the user database — there is no separate app-level users table. A generic `Keycloak[T]` client (`internal/keycloak/keycloak.go`) maps Go struct fields to Keycloak user attributes via `keycloak:"..."` struct tags (see `internal/datamodel/user.go`), using client-credentials (service account) auth with token caching/rotation (`internal/keycloak/auth.go`).
- Keycloak admin-event webhooks (`internal/keycloak/webhook.go`, `EnsureWebhook`/`NewWebhookHandler`) notify the app of user changes for async processing.

## Data Model
No relational "member" schema — Keycloak *is* the member database. Key entity, `datamodel.User` (`internal/datamodel/user.go`), mapped onto Keycloak user attributes:
- Identity: UUID, username, first/last name, email, email-verified, creation time.
- Membership/access: `FobID` (keyfob), `WaiverState`, `NonBillable`, `DiscountType`, `BuildingAccessApprover` (who granted access — also acts as an "access enabled" flag), signup timestamp, last-swipe (visit) timestamp, signup-email-sent timestamp.
- Payment: embedded `PaypalMetadata` (price, last-payment time, transaction ID) plus `StripeCustomerID`/`StripeSubscriptionID`/`StripeCancelationTime`. `PaymentStatus()` derives one of NonBillable/StripeActive/Paypal/InactiveOrUnknown.
- Discord: `DiscordUserID` for linking a Discord account to a member.
- `datamodel.Event` — normalized calendar event (name, description, start/end epoch, members-only flag), sourced from Discord's scheduled-events API and expanded from RRULE recurrence (`internal/events/events.go`).
- `datamodel.PriceDetails`/`Prices` — Stripe product/price/coupon data flattened into yearly/monthly pricing with best-discount selection (`internal/datamodel/prices.go`).
- Secondary Postgres store (`internal/reporting/reporting.go`) for an append-only audit/event log (`profile_events`: time, email, reason, message) and daily member-count metrics (`profile_metrics`), plus a `swipes` table it queries (populated by an external door-access system) to reconcile last-visit timestamps.

## Features

**People/rosters**
- Self-service signup: email-only registration creates a Keycloak user and kicks off Keycloak's native password-reset/email-verification flow; rate-limited and capped by a configurable max-unverified-account count to block spam (`internal/server/handlers_forms.go` `newRegistrationFormHandler`, `internal/keycloak/keycloak.go` `RegisterUser`).
- Contact-info self-edit (first/last name) (`internal/server/handlers_forms.go` `newContactInfoFormHandler`).
- Digital waiver signing via Docuseal: server creates a submission and redirects the member to sign; a webhook marks `WaiverState = "Signed"` on completion (`internal/server/handlers_docuseal.go`).
- Building-access keyfob assignment flow: an already-approved member with a fob "grants" a new fob by swiping it, the system watches recent swipe events for a not-yet-assigned fob ID and binds it to the target member, recording who approved access (`internal/server/handlers_admin.go` `newAssignFobHandler`, `reporting.GetLatestSwipe`/`LastFobAssignment`).
- Automatic deactivation of members absent > ~182 days (`absentThres`) and deletion of unconfirmed signups that never verify, run as a scheduled job (`cmd/visit-check-job/main.go`).
- Visit tracking: nightly job pulls last-swipe timestamps from the door/reporting DB and writes them back onto the Keycloak user record (`cmd/visit-check-job/main.go` `updateTimestamps`).
- Admin CSV roster export (name, email, verified, waiver, payment status, building-access flag, discount type, fob ID, signup/last-visit) gated to the `leadership` group (`internal/server/handlers_admin.go` `newAdminDumpHandler`).
- QR code generation for a member's keyfob/profile link (`internal/server/handlers_forms.go`/`ui.go`, using vendored `go-qrcode`).
- Encrypted "secrets" sharing feature — members can encrypt a short text value (e.g. a door code) to themselves or another named user via `age`, producing a shareable URL that only the intended recipient (or leadership) can decrypt (`internal/server/handlers_secrets.go`).

**Third-party integrations / payments**
- Stripe subscription checkout with per-member pricing/coupons and PayPal-rate migration (charges the member their old PayPal price/interval on first Stripe checkout) (`internal/payment/pricing.go` `NewCheckoutSessionParams`).
- Stripe price/coupon cache refreshed hourly and on `price.*`/`coupon.*` webhooks (`internal/payment/pricecache.go`).
- Stripe billing-portal handoff for existing subscribers to self-manage payment method/cancellation (`internal/server/handlers_stripe.go` `newStripeCheckoutHandler`).
- Stripe webhook handler reconciles subscription created/updated/deleted events: updates Stripe IDs on the Keycloak user, revokes `BuildingAccessApprover` on past-due, cancels any lingering PayPal subscription on migration, and syncs Keycloak group membership to reflect active/inactive (`internal/server/handlers_stripe.go` `newStripeWebhookHandler`).
- Legacy PayPal dues reconciliation job: polls PayPal subscription status for all members still on PayPal, deactivates members whose subscription is cancelled, and updates cached price/payment-time metadata (`cmd/paypal-check-job/main.go`, `internal/paypal/client.go`).
- Discord bot: `/link` slash command issues an HMAC-signed link URL tying a Discord user ID to a member account; role sync job adds/removes a "member" Discord role based on active-membership status (`internal/chatbot/discord.go`, `cmd/profile-async/main.go` `handleDiscordSync`).
- Discord scheduled-events polling turned into a public calendar API (`/api/events`), expanding recurring events via RRULE and flagging "(member event)"-tagged events as members-only (`internal/events/events.go`, `internal/server/handlers_api.go`).
- "Conway" integration (external system, URL/token configured) — pushes member confirmation status out to it (`cmd/profile-async/main.go` `handleConwaySync`).
- Prometheus metrics endpoint on a separate port (`cmd/profile-server/main.go`).

**Communication**
- Signup confirmation/password-reset email triggered through Keycloak's own email flow, deduplicated and time-boxed to 24h after signup (`cmd/profile-async/main.go` `handleUserSignupEmail`).
- Discord role/nickname-based membership visibility (see above).

## Integrations
Keycloak (identity/user store + admin webhooks), Stripe (subscriptions, billing portal, webhooks), PayPal (legacy dues, being sunset), Discord (bot slash command + scheduled events + role sync, via `discordgo`), Docuseal (e-signature waivers, webhook), `age` CLI (asymmetric encryption for the secrets-sharing feature), Postgres (audit-log/metrics sink only), Conway (unspecified external membership system), Prometheus (metrics).

## Notable Implementation Details
- Async work is dispatched by a single "profile-async" binary (`cmd/profile-async/main.go`) that appears to consume events (Keycloak webhook userIDs, Discord user IDs) and fan out to handler functions — a lightweight in-process pub/sub rather than a queue broker (backed by `internal/flowcontrol` — worker/workqueue/retry-loop helpers reused across the pricing cache, events cache, and reporting sink).
- All periodic jobs (`paypal-check-job`, `visit-check-job`) are separate `cmd/` binaries meant to run as cron/scheduled containers, not goroutines in the main server — a clean separation of request-serving vs. batch reconciliation.
- Keycloak-as-database is the standout pattern: a generic reflection-based mapper (`keycloak:"attr.xyz"` struct tags) turns Keycloak's free-form user-attribute bag into a typed Go struct, avoiding a separate members table entirely — but ties the whole app tightly to Keycloak's attribute API and its eventual consistency/rate limits.
- The `paypal` package's client.go literally comments itself as "a terrible collection of Paypal-related code that has accumulated over time... not refactoring since hopefully we'll get to remove it" — an explicit example of accepted legacy-migration debt, useful context if recreating a similar payment-migration feature (build it to be deleted).
- Auth model has a real gap for anyone recreating this: it assumes a trusted reverse proxy (oauth2-proxy) strips/sets the `X-Forwarded-*` headers; the code has a dev-only backdoor (`getUserID` falls back to `TESTUSERID` env var when the header is absent) — must never be reachable in production without the proxy in front.
- The encrypted-secrets feature reuses the `age` CLI via `os/exec` rather than a Go crypto library — simple but couples correctness to the CLI's presence/behavior in the container image.
- Rate limiting is applied ad hoc per external call site (`golang.org/x/time/rate.Limiter`) around Keycloak writes and PayPal polls rather than centralized — reasonable for this scale but easy to miss a call site.

## Verdict
Substantive and directly relevant to people/rosters: a real, production-shaped membership system (signup, waiver, dues payment with migration, keyfob/building-access grant, visit-based auto-deactivation, Discord sync) for a comparable volunteer-run makerspace org. Worth stealing conceptually: the "identity provider as attribute store" pattern (if already running Keycloak/similar), the auto-deactivation-by-inactivity job, the keyfob-grant-by-swipe UX, and the deliberately temporary/isolated legacy-payment-migration code as a model for how to scope out a sunset integration. MIT-licensed — ideas and patterns only, per project convention (no code copied).

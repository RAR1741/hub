# Badges

Badges are credential/training records a person holds — e.g. a safety certification or tool
qualification — awarded on their profile and defined in a shared catalog admins manage.

## How it works

- **Catalog** (`badge` table): name, category, description, a hex color for the dot shown next to
  the badge, an optional `teamId` that scopes the badge to one team, and `allowSelfAward`. Managed
  at `/admin/badges` (create) and `/admin/badges/[id]` (edit/delete), admin-only
  (`hasRole(viewer.role, "admin")` redirect-gates the page; APIs are `withRole("admin", …)`).
- **Award** (`badge_award` table): links a badge to a person with `awarded_by`, an optional note,
  and a timestamp. A person can't hold the same badge twice (unique violation → 409).
- **Team-scoped badges:** if a badge has a `teamId`, awarding it to someone who isn't a member of
  that team is rejected (409, checked in `awardBadge()`). `listAwardableBadges()` filters the
  "award" dropdown down to badges the person is actually eligible for (not already held, and
  either team-unscoped or the person is on that team).
- **Who can award:** `canAwardBadge()` in `src/lib/badges.ts` — a mentor or admin can award any
  badge; a student can only award a badge to *themselves*, and only if that badge has
  `allowSelfAward` set. The award panel (`BadgeAwardPanel`) simply hides itself when
  `listAwardableBadges()` returns nothing, so a student without a self-awardable badge sees no
  form at all.
- **Who can revoke:** mentor or admin only (`withRole("mentor", …)` on the DELETE route) — a
  student can never revoke a badge, including their own self-awarded one. The Revoke button on
  `/people/[id]` is likewise only rendered `hasRole(viewer.role, "mentor")`.

## Visibility

Held badges are shown to anyone who can view the profile at all — `canViewProfile()` lets a
person view their own profile, and mentors/admins view anyone's. There's no additional gate on the
Badges section itself, so a student sees their own badges same as a mentor viewing them.

## Using it

1. **Manage the catalog:** `/admin/badges` → **Create badge** (`BadgeForm`) sets name, category,
   description, color, an optional team scope, and whether it's self-awardable. Click into a badge
   at `/admin/badges/[id]` to edit or delete it.
2. **Award a badge:** on `/people/[id]`, the **Badges** section shows a dropdown of badges the
   viewer is allowed to award to this person plus a note field, or nothing if none apply.
3. **Revoke a badge:** mentors/admins see a **Revoke** button next to each held badge, with a
   confirm prompt.

## APIs

- `GET /admin/badges`, `/admin/badges/[id]` (pages) + `POST /api/admin/badges`,
  `PATCH`/`DELETE /api/admin/badges/[id]` — catalog CRUD, admin-only.
- `POST /api/people/[id]/badges` — award; `withRole("student", …)` at the route level, with the
  real authorization done by `canAwardBadge()` inside the handler.
- `DELETE /api/people/[id]/badges/[badgeId]` — revoke; `withRole("mentor", …)`.

Source: `src/lib/badges.ts`.

## Caveats

- Deleting a badge from the catalog (`/admin/badges/[id]`) cascades: every `badge_award` row for
  it is deleted too, stripping the badge from everyone who held it. The delete button's confirm
  prompt says as much, but doesn't say how many people are affected.
- Changing a badge's `teamId` after people already hold it doesn't retroactively revoke anyone;
  the team check only runs at award time.

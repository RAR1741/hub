# Design system + "Mission Control" UI redesign — design

**Status:** approved (brainstorm), pending spec review
**Date:** 2026-08-31
**Issue:** #213
**Branch:** `design-system-redesign`
**Visual source of truth:** `docs/design/mission-control-mockup.html` (self-contained; has its own light/dark/system toggle)

## Summary

Two goals, deliberately done as **one effort** because the redesign is the natural
forcing function for the design-system work:

1. **Visual redesign** — ship the approved "Mission Control" direction (variation 1A
   + the color-coded nav groups and role-tinted avatars grafted from 1D), and make the
   kiosk theme-aware.
2. **Formalize the design system** — the hub already has a mature *CSS-based* system
   (theme tokens + a `@layer components` class vocabulary in `globals.css`, documented in
   `docs/design/ui-system.md` + `.design-sync/conventions.md`, synced to claude.ai/design).
   The gaps are: only one React primitive (`Icon`) exists, adoption of the class
   vocabulary isn't 100% uniform, and there's no living reference. Close those gaps with a
   small set of thin, typed React primitives over the existing classes, tighter adoption,
   a dev-gated styleguide route, and legacy-token cleanup.

This is a **product app, not a distributable design system** (per `.design-sync/NOTES.md`).
Scope was chosen as **Medium**: extend the CSS-first system + ~7 React primitives. Out of
scope by explicit decision: Storybook, a separate package/versioning, a token-JSON
pipeline, and a big-bang rewrite of all ~75 components.

## Current state (what already exists — do not rebuild)

- **Tokens** in `globals.css`: `--red`/`--red-press`/`--red-fg`, warm-neutral surfaces
  (`--canvas`/`--surface`/`--surface-2`/`--ink`/`--muted`/`--hair`), `--steel`/`--steel-soft`,
  attendance status (`--present`/`--excused`/`--optional`/`--absent` each with `-fg`), roles
  (`--role-student`/`--role-mentor`; admin = red), `--shadow`. Light on bare `:root`; dark
  under both `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and
  `:root[data-theme="dark"]`. Legacy `--color-*` aliases still resolve to these.
- **Component classes** (`@layer components`): `.btn`/`.btn-primary`/`.btn-secondary`/
  `.btn-danger` + `.btn.icon`/`.btn.danger`; `.card`/`.card-head`; `.tablewrap`/`.table`/
  `.toolbar`/`.search`; `.pill`/`.badge` (`.role`/`.admin`/`.on`/`.off`/`.status-*`); `.stat`
  (+ `.bar`); `.eyebrow`; form controls `.label`/`.field`/`.input`; signature `.pit`/`.pit-row`/
  `.clock`, `.mono`, `.hazard`.
- **Conventions** (already baked in): global `:focus-visible` ring, `prefers-reduced-motion`
  guard, in-flight button disable+label-swap, empty-state copy, `role="status"`/`role="alert"`
  feedback.
- **Adoption today** (measured): 81 files use `.btn`; ~10 files hand-roll button markup in
  inline Tailwind; 44 files use the form classes. Adoption is already high — the migration
  tail is small.
- **React primitives today:** only `Icon` (`src/components/Icon.tsx`).
- **Fonts:** self-hosted via `next/font/google` (Archivo display, Inter body, JetBrains Mono
  data), exposed as `--font-display`/`--font-body`/`--font-mono`.

## Part 1 — Visual redesign ("Mission Control")

### 1a. Colored nav groups
The primary nav becomes a **left grouped sidebar** (with a collapsed icon rail) + a **mobile
bottom tab bar** (per the mockup). Each nav group carries a quiet signature hue on its header,
item icons, active tick, and faint active tint — **accent-level only, never a filled panel**;
red remains the single brand accent.

New tokens (light / dark), following the existing dual-block pattern:
- `--hue-overview` = `var(--red)` / `var(--red)`
- `--hue-shopfloor` = `#B45309` / `#FBBF24`
- `--hue-team` = `#2563EB` / `#60A5FA`
- `--hue-admin` = `#7C3AED` / `#A78BFA`

Consumed via a single `--grp` custom property set once per group container; descendant rules
read `var(--grp, <fallback>)`. Groups → items (from `SiteNav.tsx`): **Overview** (Home,
Leaderboard), **Shop floor** (Kiosk, Shop), **Team** (People, Teams, Events), **Admin** (Admin).
Role-gating of items is unchanged from today's `SiteNav`.

### 1b. Role-tinted avatars
Avatar initials read the existing `--role-*` tokens as a soft `color-mix()` fill + matching
ring; **admin = solid red**. No new semantic tokens. Becomes the `Avatar` primitive (Part 2).

### 1c. Theme-aware kiosk
The `.kiosk*` block in `globals.css` currently **hardcodes dark** hex (`#101114`, `#f3f1ec`,
`#23262c`, `#9aa0a8`, red `#e01926`) and does **not** follow the theme. Rework it to use the
theme tokens (`--canvas`/`--surface`/`--ink`/`--hair`/`--muted`/`--red`) so it honors
light/dark/system like the rest of the app.
- **Constraint (locked):** keep the three-lane layout **Students | On the clock | Mentors**
  in `KioskBoard.tsx`. Restyle visuals only — do not change the lane structure or labels.
- **Note:** this reverses the prior "kiosk is committed-dark by design" decision recorded in
  `.design-sync/NOTES.md` and `ui-system.md`. Update both docs as part of this work.

### 1d. Deliberately NOT taken from variation 1D
Larger radius (stays 8px), warmer neutrals, and the hued progress bar — left as 1A had them.

## Part 2 — Design-system formalization

### 2a. React primitives (~7 thin wrappers) → `src/components/ui/`
Each primitive **emits the existing component classes** — it is a typed, hard-to-misuse
wrapper, not a second styling path. A class change in `globals.css` still propagates
everywhere. `Icon.tsx` moves into `src/components/ui/` (update imports).

| Primitive | Wraps | Notes |
|---|---|---|
| `Button` | `.btn` + variant | `variant: 'primary' \| 'secondary' \| 'danger'`; `icon?`; `pending?` bakes in the in-flight disable + label-swap convention |
| `Card` (+ `Card.Head`) | `.card`/`.card-head` | layout via children |
| `Field` | `.label`/`.field`/`.input` | label + control + optional error text; wires `aria-describedby` |
| `Pill` | `.pill`/`.badge` variants | role/status variants map to existing classes |
| `Avatar` | new role-tint (1b) | `role: 'student' \| 'mentor' \| 'admin'`, initials |
| `Stat` | `.stat` (+ `.bar`) | mono number + optional goal meter |
| `TableWrap` | `.tablewrap`/`.table` | the `overflow-x-auto` shell |

Primitives are presentational only — no data fetching, no app coupling. The other ~75
components in `src/components/` stay app/data-coupled and are **not** moved.

### 2b. Migration strategy — as-you-touch (NOT big-bang)
- Extract the primitives.
- Adopt them in the surfaces the redesign already touches: nav, kiosk, dashboard, and a
  couple of high-traffic tables.
- Migrate the **~10 hand-rolled-button stragglers** onto `Button`.
- Everything else converts opportunistically; new code uses primitives by convention.
- Rationale: a rewrite of all 75 components buys little (81 already use `.btn`) and risks a lot.

### 2c. Dev-gated styleguide route
A `/styleguide` route that renders the **actual** primitives (every variant, both themes) so
it can't drift from reality — it becomes the source of truth, replacing the static mockup HTML.
- **Gating:** dev/non-prod only, on the unforgeable `VERCEL_ENV !== "production"` signal (per
  the repo's dev-route CI-gating convention — do not gate on `NODE_ENV`, which is `production`
  under `next start` in CI). Confirm 404 in prod.

### 2d. Legacy token cleanup
Find the remaining `--color-*` alias users, replace with the short token names, then drop the
aliases from `globals.css`. (Small, per the measured adoption.)

### 2e. Docs + design-sync
- Update `docs/design/ui-system.md`: document the new primitives + `src/components/ui/`, the
  colored-nav tokens, the role-avatar treatment, and the now-theme-aware kiosk.
- Update `.design-sync/conventions.md` to enumerate the primitives + new tokens.
- Regenerate `.design-sync/hub.css`: `./dev node .design-sync/build-hub-css.mjs` (required
  after any `globals.css` change, per `.design-sync/NOTES.md`).
- Replace `docs/design/ui-direction-mockup.html` references with
  `docs/design/mission-control-mockup.html` as the interim visual reference (the `/styleguide`
  route is the durable one).

## Data flow / architecture notes

- No schema changes, no migrations, no server/data changes. This is a presentation-layer
  effort end to end.
- The container two-URL seam, auth cookies, and RLS are untouched.
- `SiteNav.tsx` is a server component today; the sidebar + flyout submenus in the mockup are
  CSS-driven (`:hover`/`:focus-within`, no JS) and the mobile bottom bar + "More" sheet may
  need a small client component. Keep client JS minimal; prefer CSS.

## Error handling / edge cases

- **Theme flash:** the existing pre-paint inline script in `layout.tsx` already applies the
  stored theme before paint — the kiosk becoming theme-aware must not reintroduce a flash;
  verify.
- **Contrast:** every new hue must hold AA in both themes (the dark hues are lightened
  variants for this reason). Verify overview/shopfloor/team/admin on both surfaces.
- **Kiosk readability:** it's an always-on shop tablet — confirm the light theme is still
  readable at a glance across the room (this is why it was dark before; validate before
  assuming light is fine, and keep the option to default kiosk to a specific theme if needed).
- **Primitive escape hatches:** each primitive must forward `className` and relevant native
  props so a one-off need doesn't force abandoning the primitive.

## Testing

- `./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run test`, `./dev npm run e2e`
  all green before PR (per AGENTS.md).
- Manual browser check at this worktree's app URL (`http://localhost:3004`) in **both themes**
  and at mobile width: nav groups + flyouts, bottom tab bar, role avatars, kiosk light/dark
  with the three lanes intact.
- `/styleguide` renders all primitives in both themes; confirm it 404s when `VERCEL_ENV=production`.
- Regenerate + eyeball `.design-sync/hub.css`.

## Rollout

- Standard: PR against `master`; merge is a production deploy (Vercel auto-deploy). No
  migration/env steps required.

## Open questions

- Kiosk default theme: follow viewer theme everywhere, or force the kiosk *device* to a chosen
  theme (e.g. remember dark on the shop tablet) while making the styles theme-capable? Default
  assumption: follow the theme; revisit if the shop tablet reads poorly in light.

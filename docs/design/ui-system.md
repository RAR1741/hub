# UI & design system

Team Hub's look is a "shop-floor control panel" — warm-neutral surfaces, Red Alert red, a cool
steel secondary, and mono data readouts. The **visual source of truth is the `/styleguide`
route** (dev-only, gated on `VERCEL_ENV` — 404s in prod), which renders every primitive below in
both light and dark theme, live against the real tokens/classes. `docs/design/
mission-control-mockup.html` is the static reference the nav/kiosk redesign was ported from (open
it locally; it has its own light/dark/system toggle) — useful for the original layout intent, but
`/styleguide` is what to check a change against.

Styling is Tailwind CSS v4, CSS-first — there's no `tailwind.config.js`; everything (theme tokens,
dark-mode variants, and the shared component layer) lives in `src/app/globals.css` via
`@import "tailwindcss"`, a token `:root` block, and a `@layer components`.

**Fonts.** Self-hosted via `next/font/google` in `src/app/layout.tsx` (build-time — no runtime CDN
request): **Archivo** for display/headings, **Inter** for body/UI text, **JetBrains Mono** for data
readouts (hours, percentages, IDs, timestamps, counts). Each is exposed as a CSS variable
(`--font-display`, `--font-body`, `--font-mono`) set on `<html>`/`<body>` and referenced from
`globals.css`.

**Theme tokens.** Light values live on bare `:root`; dark values are defined twice — once under
`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` for the OS-driven case, and
again under `:root[data-theme="dark"]` for an explicit user choice — so light/dark/**system** all
work. The palette: brand red (`--red`/`--red-press`/`--red-fg`), warm-neutral surfaces (`--canvas`/
`--surface`/`--surface-2`/`--ink`/`--muted`/`--hair`), a cool steel secondary (`--steel`/
`--steel-soft`), and the M4 attendance-status colors (`--present`/`--excused`/`--optional`/
`--absent`, each with a `-fg` pair). Older `--color-*` aliases (`--color-brand`, `--color-present`,
etc.) still resolve to these so pre-M5 pages pick up the palette without individual edits.

**Theme toggle.** `ThemeToggle.tsx` in the nav toggles light/dark, sets/removes `data-theme`
on `<html>`, and persists the choice to `localStorage`. A small inline script in `layout.tsx`'s
`<head>` applies the stored value before paint, so there's no flash of the wrong theme.

**Colored nav groups (`--hue-*` + `--grp`).** The grouped sidebar/rail tints each nav section by
role area: `--hue-overview` (red), `--hue-shopfloor` (amber/orange), `--hue-team` (blue), and
`--hue-admin` (purple), each with a light and dark value. Every `.sb-group`/rail group sets a
local `--grp: var(--hue-*)` custom property; descendant rules (`.sbi .ic`, `.sbi.active`,
`.sbi.active::before`, the flyout title, the rail equivalents) read `var(--grp, <fallback>)` so
one CSS declaration per rule works across all four groups — no per-group class duplication. The
fallback (`var(--muted)` or `var(--red)`) applies outside a `.sb-group` (e.g. ungrouped items).

**Role-tinted avatars.** `.avatar.role-student` / `.avatar.role-mentor` tint the initials circle
toward `--role-student`/`--role-mentor` via `color-mix(in srgb, <role color> 20%, var(--surface))`
for the fill and a 45%-mix border; `.avatar.role-admin` uses the solid brand red (`--red`/
`--red-fg`) since admin has no dedicated role color. Pass `role` to the `Avatar` primitive (see
below) to get the tint; omit it for the plain steel-fill default.

**Component classes.** Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn.icon`
for icon-only actions, `.btn.danger` for a subtler destructive row-action), `.card`/`.card-head`,
`.tablewrap`/`.table`/`.toolbar`/`.search` (sticky header, row hover, an `overflow-x-auto` wrapper
for wide tables on narrow viewports), `.pill`/`.badge` (`.role`, `.admin`, `.on`/`.off`, and the
attendance `.status-*` variants), `.stat` (a big mono number with an optional `.bar` goal meter),
`.eyebrow` (small uppercase label), and form controls (`.label`, `.field`, `.input`).

## React primitives (`src/components/ui/`)

Eight typed React wrappers over the component classes above live in `src/components/ui/`, exported
from a single barrel (`src/components/ui/index.ts`). Each one is a thin wrapper — it emits the same
class names a hand-written element would, not a second styling path — so it's safe to reach for a
primitive or write the classes by hand interchangeably. `/styleguide` renders all eight live.

- **`Button`** — wraps `.btn`. `variant` (`"primary"` default | `"secondary"` | `"danger"`) picks
  `.btn-primary`/`.btn-secondary`/`.btn-danger`; `icon` (boolean) adds `.icon` for a square
  icon-only button; `pending` (boolean) disables the button and swaps its children for
  `pendingLabel` while a request is in flight (`Saving…`, `Deleting…`), matching the app-wide
  in-flight convention. See "Button coverage" below for what it deliberately can't express.
- **`Card`** — wraps `.card`. `Card.Head` wraps `.card-head` (the flush title-row header).
- **`Field`** — wraps `.label`, associates a generated or passed-in `id` with its child control via
  `useId`/`cloneElement`, and renders an optional `role="alert"` error message wired up with
  `aria-describedby`.
- **`Pill`** — wraps `.pill`. `tone` picks a modifier class (`"role"`, `"admin"`, `"on"`, `"off"`,
  `"new"`, `"update"`, `"error"`, or one of the attendance `"status-*"` tones).
- **`Avatar`** — wraps `.avatar`. `initials` is the rendered text; `role`
  (`"student"`/`"mentor"`/`"admin"`) adds the matching `.role-*` tint class (see "Role-tinted
  avatars" above).
- **`Stat`** — wraps `.stat`/`.eyebrow`/`.num`/`.bar`. `label`, `value`, and an optional `bar`
  (0..1, clamped) for the goal-meter fill.
- **`TableWrap`** — wraps `.tablewrap`, the `overflow-x-auto` scroll container every `.table` sits
  inside.
- **`Icon`** — moved here from `src/components/Icon.tsx` (same API: `name=…` picks a small
  inline-SVG icon, `currentColor` stroke, no external icon library — edit, trash, plus, search,
  check, x, calendar, clock, users, eye, chevron).

**Button coverage.** `Button` only emits `.btn-{primary|secondary|danger}` (plus `.icon`) — it has
no `variant` for a bare `.btn` with no color modifier, and no way to combine `.icon` with the
subtler `.btn.danger` row-action tone. A handful of buttons stay hand-rolled by design because of
this gap: the login page's neutral dev-login buttons (Student/Mentor/Admin), and a few row-level
icon-danger actions elsewhere. A future `neutral` variant (bare `.btn`) and an icon-capable danger
tone could absorb these; until then, hand-writing `className="btn"` or `className="btn icon danger"`
is the correct, sanctioned escape hatch rather than forcing them through `Button`.

**Signature elements.** The **pit board** (`.pit`/`.pit-row`, used by the dashboard's "in the shop"
list and the kiosk's on-the-clock column) shows an index, name, and a live mono clock-in duration
via `.clock`. Mono readouts (`.mono`, tabular-nums) are used everywhere a number should feel like an
instrument reading — hours, percentages, IDs, durations. The **hazard stripe** (`.hazard`, a
diagonal red/ink repeating gradient) marks the top of the app shell and the kiosk. The kiosk board
(`/kiosk`) is **theme-aware** — it follows light/dark/system like the rest of the app via the same
`--canvas`/`--surface`/`--surface-2`/`--ink`/`--muted`/`--hair` tokens, rather than the hardcoded
dark palette it used to ship. It keeps its own large touch targets (min-height 52–58px search/name
buttons) and its three-lane layout (Students | On the clock | Mentors) unchanged — those are about
being a shared shop-floor touch device, not about theme.

**Consistency conventions.** Every interactive control gets a visible `:focus-visible` outline
(defined once in `globals.css`, so new controls inherit it automatically). All animation respects
`prefers-reduced-motion: reduce` (a global guard collapses animation/transition durations to
~instant). Buttons that trigger a fetch disable themselves and swap their label while the request is
in flight (`Saving…`, `Deleting…`, etc.) so a slow network can't produce a duplicate submit. Empty
lists use active-voice copy that names the next action ("No members yet — add your first above")
rather than a blank table or a terse "None." Save/delete feedback uses the same inline
`role="status"`/`role="alert"` pattern across every form and row action.

**Admin.** `/admin` is a card-grid hub (mentor+; cards are role-gated, so a mentor sees only the
areas they can act on) linking every admin area with live counts — People, Teams, Periods, Meetings,
Build days, Sessions, Flagged sessions, Kiosk devices, Requests, Settings. Every model in the schema
has full create/read/update/delete reachable from the hub (person, team, period, meeting, build_day,
session, kiosk_device, plus read/update for app_setting and the requests review queues) — see the
CRUD gap table in `docs/superpowers/plans/2026-08-12-m5-ui-and-crud.md` for what M5 closed.

Pages are built from semantic HTML (`<main>`, `<table>`, `<form>`, `<label>`, headings) styled with
Tailwind utility classes plus the component classes above. Reach for the existing component classes
and utilities before adding new bespoke CSS.

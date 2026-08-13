# UI & design system

Team Hub's look is a "shop-floor control panel" — warm-neutral surfaces, Red Alert red, a cool
steel secondary, and mono data readouts — approved in `docs/design/ui-direction-mockup.html` (open
it locally; it has its own light/dark/system toggle and is the visual source of truth).

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

**Component classes.** Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn.icon`
for icon-only actions, `.btn.danger` for a subtler destructive row-action), `.card`/`.card-head`,
`.tablewrap`/`.table`/`.toolbar`/`.search` (sticky header, row hover, an `overflow-x-auto` wrapper
for wide tables on narrow viewports), `.pill`/`.badge` (`.role`, `.admin`, `.on`/`.off`, and the
attendance `.status-*` variants), `.stat` (a big mono number with an optional `.bar` goal meter),
`.eyebrow` (small uppercase label), and form controls (`.label`, `.field`, `.input`). An `<Icon
name=… />` component (`src/components/Icon.tsx`) provides a small inline-SVG icon set (edit, trash,
plus, search, check, x, calendar, clock, users, chevron) — no external icon library.

**Signature elements.** The **pit board** (`.pit`/`.pit-row`, used by the dashboard's "in the shop"
list and the kiosk's on-the-clock column) shows an index, name, and a live mono clock-in duration
via `.clock`. Mono readouts (`.mono`, tabular-nums) are used everywhere a number should feel like an
instrument reading — hours, percentages, IDs, durations. The **hazard stripe** (`.hazard`, a
diagonal red/ink repeating gradient) marks the top of the app shell and the kiosk. The kiosk board
(`/kiosk`) is intentionally hardcoded dark regardless of theme — it's a always-on shop tablet, not a
themed page.

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
CRUD gap table in `docs/plans/2026-08-12-m5-ui-and-crud.md` for what M5 closed.

Pages are built from semantic HTML (`<main>`, `<table>`, `<form>`, `<label>`, headings) styled with
Tailwind utility classes plus the component classes above. Reach for the existing component classes
and utilities before adding new bespoke CSS.

# FRC 1741 Hub — design system

Team Hub's look is a **"shop-floor control panel"**: warm shop-paper neutrals, Red
Alert red, a cool steel secondary, and mono data readouts. It is a **CSS design
system**, not a component library — the vocabulary is a set of semantic CSS
classes plus design tokens, all defined in `styles.css`. Only one React component
ships (`Icon`).

## How to build with it

- **Compose with the semantic classes below** (`.btn`, `.card`, `.table`, `.pill`,
  `.stat`, …) for anything the hub already has a part for. Reach for these before
  inventing bespoke styles.
- **Use Tailwind utilities for layout glue** (flex, grid, gap, spacing, width) —
  the semantic classes style the *parts*, utilities arrange them.
- **Use the `var(--*)` tokens** for any custom color/spacing so it tracks the theme.
  Never hardcode a hex the tokens already name.
- **Light/dark is automatic.** Tokens flip under `prefers-color-scheme: dark` and
  under an explicit `[data-theme="dark"]` on the root. Build in token colors and
  both themes just work.
- **Semantic HTML.** Pages are `<main>`/`<table>`/`<form>`/`<label>` + headings,
  styled with these classes. Every interactive control inherits a red
  `:focus-visible` ring automatically.

## Tokens

**Fonts** — `--font-display` (Archivo, headings), `--font-body` (Inter, UI text),
`--font-mono` (JetBrains Mono, all numeric/data readouts: hours, %, IDs, counts).

**Color** (light values; dark auto-flips):
- Brand: `--red` `#e01926`, `--red-press`, `--red-fg`
- Surfaces: `--canvas` (page), `--surface` (cards), `--surface-2` (insets),
  `--ink` (text), `--muted` (secondary text), `--hair` (borders)
- Secondary: `--steel`, `--steel-soft`
- Attendance status (each has a `-fg` pair): `--present` (green), `--excused`
  (blue), `--optional` (grey), `--absent` (orange)
- Roles: `--role-student`, `--role-mentor`
- Nav group hues: `--hue-overview` (red), `--hue-shopfloor` (amber/orange), `--hue-team` (blue),
  `--hue-admin` (purple), each with a light and dark value. The grouped sidebar/rail sets a local
  `--grp: var(--hue-*)` per group; descendant rules read `var(--grp, <fallback>)` so one rule
  colors all four groups.
- `--shadow` (card elevation)
- The legacy `--color-*` aliases (`--color-brand`, `--color-surface`, …) have been retired; use
  the short token names above.

## Component classes

**Buttons** — `.btn` (base). Variants: `.btn-primary` (red, primary action),
`.btn-secondary` (neutral), `.btn-danger` (orange, destructive). Modifiers:
`.btn.icon` (icon-only square), `.btn.danger` (subtle destructive row-action —
neutral until hover). Buttons that fire a request should disable + swap their
label while in flight (`Saving…`, `Deleting…`).

**Cards** — `.card` (surface + border + shadow). `.card-head` (flush header row,
holds an `<h3>` + optional `.count` pill). `.card.pit`/`.card.meets` go flush
(padding 0) when their content supplies its own padding.

**Forms** — `.field` (column wrapper), `.label`, `.input` (also `select.input`,
`textarea.input`).

**Pills / badges** — `.pill` and `.badge` are aliases (neutral steel by default).
Tone modifiers: `.pill.admin` (red), `.pill.on` (green), `.pill.off` (muted),
`.pill.role`, and CSV-import tones `.pill.new`/`.pill.update`/`.pill.error`.
Attendance: `.badge-present`/`-excused`/`-optional`/`-absent`, or equivalently
`.pill.status-present`/`-excused`/`-optional`/`-absent`.

**Parts-pipeline status** — `.status-design` (blue), `.status-blocked` (amber),
`.status-ready` (green), `.status-working` (orange), `.status-done` (muted).

**Tables** — wrap in `.tablewrap`; optional `.toolbar` with a `.search` box;
`.table` (sticky uppercase headers, row hover). Cell helpers: `.name-cell`
(`.nm` + `.em`), `.avatar` (initials circle), `.sid` (mono ID), `.rowacts`
(right-aligned action buttons).

**Stat blocks** — `.stat` with `.num` (big mono number, `small` for a unit) and an
optional `.bar` goal meter (`<i>` is the fill).

**Pit board** — `.pit` / `.pit-row` (index `.idx`, name `.nm`, `.sub`) with a live
`.clock` (mono duration, `.live-dot`). Used for the "in the shop" roster.

**Signature chrome** — `.hazard` (thin red stripe marking the top of the shell).
`.status-strip` (dark live bar: `.live` + pulsing `.dot`, `.sep`, `.grow`,
`.date`). `.eyebrow` (small uppercase label). `.mono` (tabular-nums readout).
`.page-head` (title row: `h1`/`h2` + `.sub`).

**Kiosk** — `.kiosk` and its `.kiosk-head`/`.kiosk-body`/`.k-search`/`.k-name`/
`.k-out`/`.k-here`/`.k-mentors` etc. are **theme-aware** (they use the same `--canvas`/`--surface`/
`--ink`/`--muted`/`--hair` tokens as the rest of the app, following light/dark/system) but keep
their own large touch targets and red focus-border treatment for a shared shop-floor tablet. Don't
use kiosk classes outside `/kiosk` — they're sized for that layout, not general page content.

**Other** — `.team-tree` (pure-CSS org chart: `<ul>`/`<li>` + `.team-tree-card`),
`.shop-tile` (`.priority-high`/`.priority-low`), `.meet` (meeting list row, `.req`
tag), `.modal-backdrop`/`.modal-card`/`.modal-row`, `.signup-q`/`.signup-opt`
(form questions), `.onshape-panel`/`.onshape-part-row` (narrow CAD side panel),
`.link-btn` (inline text button), `.skeleton-line` (shimmer loading), `.skip-link`.

## React primitives (hub app internals, not part of the synced bundle)

The hub app itself wraps eight of the classes above in typed React components under
`src/components/ui/` (`Button`, `Card`, `Field`, `Pill`, `Avatar`, `Stat`, `TableWrap`, `Icon`) —
each just emits the same class names documented here, so it's not a second design vocabulary. Only
`Icon` ships in this design-sync bundle (see "Key build facts" in NOTES.md for why); the other
seven are internal typed wrappers, useful context for anyone reading the hub's source but not part
of what this package exports.

- `Button` — `.btn`, `variant` picks `.btn-primary`/`.btn-secondary`/`.btn-danger`, `icon` adds
  `.icon`, `pending`/`pendingLabel` for in-flight state.
- `Card` (+ `Card.Head`) — `.card` / `.card-head`.
- `Field` — `.label` + wired-up `id`/`aria-describedby`/error text.
- `Pill` — `.pill` + a `tone` modifier.
- `Avatar` — `.avatar` + a `role` tint (`student`/`mentor`/`admin`).
- `Stat` — `.stat`/`.eyebrow`/`.num`/`.bar`.
- `TableWrap` — `.tablewrap`.

## The `Icon` component

`<Icon name="…" />` renders a small inline SVG (24×24, `currentColor` stroke, no
external icon library). It takes `className` for sizing/color. Available names:
`edit`, `trash`, `plus`, `search`, `check`, `x`, `calendar`, `clock`, `users`,
`eye`, `chevron`. Icons inherit text color; size via a class (e.g. `.btn svg` is
15px, `.search svg` is 16px).

## Conventions

- Every interactive control gets a visible `:focus-visible` outline (global).
- Animation respects `prefers-reduced-motion: reduce` (global guard).
- Empty states use active-voice copy naming the next action ("No members yet —
  add your first above"), not a blank table.
- Inline save/delete feedback uses `role="status"` / `role="alert"`.

---
name: Team Hub
description: Shop-floor control panel for FRC Team 1741 attendance and roster tracking
colors:
  red: "#e01926"
  red-press: "#b4131d"
  red-fg: "#ffffff"
  canvas: "#f5f2ee"
  surface: "#ffffff"
  surface-2: "#fbf9f6"
  ink: "#1b1719"
  muted: "#6e6863"
  hair: "#e5e0d9"
  steel: "#55636e"
  steel-soft: "#eaedef"
  present: "#1f9d57"
  excused: "#2c6be6"
  optional: "#6b7079"
  absent: "#d67a22"
  role-student: "#4c9df0"
  role-mentor: "#e0a020"
typography:
  display:
    fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif"
    fontWeight: 800
    fontSize: "22px"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif"
    fontWeight: 750
    fontSize: "14px"
    letterSpacing: "0.01em"
  body:
    fontFamily: "var(--font-body), ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.16em"
  mono:
    fontFamily: "var(--font-mono), ui-monospace, \"Cascadia Code\", \"SF Mono\", Menlo, Consolas, monospace"
rounded:
  sm: "8px"
  md: "9px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.red-fg}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.red-press}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
---

# Design System: Team Hub

## Overview

**Creative North Star: "The Shop-Floor Control Panel"**

Team Hub reads like the instrument panel on a robotics team's shop floor, not a generic SaaS
dashboard. Warm-neutral "shop paper" surfaces hold the page; Red Alert red is the single loud
signal reserved for brand and primary action; a cool steel secondary handles quieter structural
UI (badges, counts, borders-on-hover); and every number that matters — hours, percentages, IDs,
timestamps, live clock-in durations — renders in a monospace, tabular-nums readout, so it feels
measured rather than typeset. The kiosk (`/kiosk`) pushes this furthest with an always-on shop-tablet
posture — large touch targets, its own red focus-border treatment — but it follows the same
light/dark/system theming as the rest of the app, rather than a page a person configures separately.

The system is functional first: dense admin tables, role-gated CRUD, and status pills carry more
of the visual weight than decoration does. Personality lives in specific, repeated details — the
hazard stripe, the pit board, the live pulsing status dot — not in broad ornament.

**Key Characteristics:**
- Warm-neutral paper canvas with a single loud red accent, used sparingly and consistently for
  brand + primary action.
- Mono, tabular-numeric readouts for every quantitative value (hours, counts, IDs, durations).
- Mostly flat surfaces with tonal layering (canvas → surface → surface-2) for depth; shadow is a
  light ambient touch, not a structural signal.
- The kiosk is a shop-floor instrument (large touch targets, its own red focus-border treatment)
  that follows the same light/dark/system theming as the rest of the app.
- Full light/dark/system theming via a `data-theme` attribute, with an inline pre-paint script to
  avoid a flash of the wrong theme.

## Colors

Warm-neutral "shop paper" ground, one loud brand red, a cool steel secondary for quiet structure,
and a fixed four-color attendance-status vocabulary that carries real semantic meaning across the
app.

### Primary
- **Red Alert Red** (`#e01926` light / `#ff3b45` dark): brand color and the only primary-action
  color — `.btn-primary`, the hazard stripe, focus rings, the live status dot, required-day
  markers. Pressed/hover state is **Red Press** (`#b4131d` light / `#e0222c` dark).

### Secondary
- **Steel** (`#55636e` light / `#8ea0ad` dark): cool mechanical secondary for quiet structural
  UI — role pills, avatar fill, hover borders on default buttons. **Steel Soft** (`#eaedef` light
  / `#262a30` dark) is its low-emphasis background (count chips, default pill background,
  progress-bar track).

### Neutral
- **Canvas** (`#f5f2ee` light / `#131417` dark): page background — "shop paper."
- **Surface** (`#ffffff` light / `#1b1d21` dark): cards, tables, inputs — the primary raised
  layer.
- **Surface 2** (`#fbf9f6` light / `#212429` dark): a half-step up from canvas — row hover,
  search-field background, the toolbar layer.
- **Ink** (`#1b1719` light / `#ece9e4` dark): primary text.
- **Muted** (`#6e6863` light / `#9c958d` dark): secondary text, labels, subheads, timestamps.
- **Hair** (`#e5e0d9` light / `#2c2f35` dark): the one border/divider color used everywhere a
  hairline is needed.

### Attendance status (fixed semantic set)
- **Present** (`#1f9d57` light / `#35c878` dark): present status pill, the pit board's live dot.
- **Excused** (`#2c6be6` light / `#5a93ff` dark): excused status pill.
- **Optional** (`#6b7079` light / `#8b93a0` dark): optional-day status pill.
- **Absent** (`#d67a22` light / `#f0973e` dark): absent status pill; also reused as the
  destructive/danger color (`.btn-danger`, error pills).

### Roster role colors
- **Role: Student** (`#4c9df0`) and **Role: Mentor** (`#e0a020`) — kept in sync with
  `ROLE_COLORS` in `src/lib/roster-colors.ts`; do not edit one without the other.
- **Role-tinted avatars**: `.avatar.role-student`/`.avatar.role-mentor` tint the initials-circle
  fill/border toward the matching role color via `color-mix`; `.avatar.role-admin` uses the solid
  brand red, since admin has no dedicated role color.

### Named Rules
**The One Red Rule.** Red is brand and primary-action only — it never appears as a generic
accent, decorative color, or a fifth attendance status. If something needs emphasis that isn't
"do this now," reach for steel or a status color, not red.

**The Mono-Numbers Rule.** Any value the user reads as a measurement — hours, percentages,
counts, IDs, durations, timestamps — renders in the mono font with tabular-nums, never the body
or display font.

## Typography

**Display Font:** Archivo (self-hosted via `next/font/google`, exposed as `--font-display`)
**Body Font:** Inter (`--font-body`)
**Label/Mono Font:** JetBrains Mono (`--font-mono`) — used for every data readout: hours,
percentages, IDs, timestamps, counts, the pit-board clock.

**Character:** A confident geometric display face over a plain, highly legible body face, with a
dedicated mono face carved out specifically for numbers that should feel like an instrument
reading rather than prose.

### Hierarchy
- **Display / Page head** (weight 800, 22px, letter-spacing -0.01em): page-level `h1`/`h2` on
  admin and list screens (`.page-head h1/h2`).
- **Title** (weight 750, 14px, letter-spacing 0.01em): card headers (`.card-head h3`).
- **Body** (400, 15px, line-height 1.5): default page text.
- **Label / Eyebrow** (weight 700, 11px, letter-spacing 0.16em, uppercase): small section labels
  and table column headers (`.eyebrow`, `.table th`).
- **Mono / Stat** (weight 750, 44px for the big stat number, line-height 1, letter-spacing
  -0.02em; 14px for inline readouts like the pit-board clock): every quantitative readout.

### Named Rules
**The Instrument Face Rule.** Mono is a distinct visual register, not a stylistic variant of
body text — it signals "this is data," so it never carries prose, labels, or button text.

## Layout

Content sits on the warm canvas background inside `card`/`tablewrap` surfaces with consistent
1px hairline borders and 8–12px radii. Admin list screens follow a `.page-head` (title + actions)
→ `.toolbar` (search/filter row) → `.tablewrap` pattern. `/admin` itself is a card-grid hub of
role-gated links with live counts. The kiosk uses a fixed three-column grid (`1.4fr 1fr 0.9fr`:
sign-in / who's-here / mentors) that collapses to a single column under 720px, and its inner grid
of name buttons steps from 2 to 3 columns at 640px. Tables get a sticky header and an
`overflow-x-auto` wrapper so wide tables scroll on narrow viewports instead of breaking layout.

## Elevation & Depth

Mostly flat with tonal layering: depth comes primarily from the canvas → surface → surface-2
lightness steps, not from shadow. A single `--shadow` token (`0 1px 2px rgba(20,16,14,.04), 0 6px
20px -10px rgba(20,16,14,.14)` light / a darker-alpha equivalent in dark mode) gives cards,
tables, the skip-link, and modals a light ambient lift — present everywhere at rest, not reserved
for hover/active state.

### Shadow Vocabulary
- **Ambient card shadow** (`--shadow`): the one elevation token, applied to `.card`, `.tablewrap`,
  the skip-link, `.team-tree-card`, and the kiosk shell. Ambient texture, not a state signal.
- **Modal shadow** (`0 12px 40px -12px rgba(0,0,0,0.5)`): the one place elevation is heavier,
  reflecting the modal's higher stacking position above a dimmed backdrop.

### Named Rules
**The Tonal-Layering Rule.** Reach for the next canvas/surface/surface-2 step before reaching
for a heavier shadow. Shadow is ambient texture on raised surfaces, not the primary way this
system expresses "this is above that."

## Shapes

Rounded, not sharp: 8–9px radii on inputs, buttons, and search fields; 11–14px on cards, tables,
modals, and the kiosk shell; fully circular (`999px`) on pills, badges, and the avatar/live-dot.
Borders are a single 1px hairline (`--hair`, including in the kiosk, which now themes like the
rest of the app) — never a heavier or colored border at rest. The one deliberate non-rounded geometric
device is the **hazard stripe** (`.hazard`): a flat 4px bar of solid red at the top of the app
shell and the kiosk, with no radius, reading as a warning strip rather than a decorative band.

## Components

Buttons, cards, and inputs feel **tactile and instrumented** — confident, slightly mechanical
touch targets that read like a control panel, with mono readouts standing in for gauges. Eight
typed React primitives in `src/components/ui/` (`Button`, `Card`, `Field`, `Pill`, `Avatar`,
`Stat`, `TableWrap`, `Icon`) wrap the classes documented below — see `docs/design/ui-system.md`
and the `/styleguide` route for the full reference.

### Buttons
- **Shape:** 9px radius, 1px border, 8px/14px padding, 650-weight 13.5px label.
- **Primary:** red background/border, white text; press state darkens to Red Press. Reserved for
  the one primary action per view.
- **Secondary:** surface background, ink text, hair border; hovers to the surface-2 tone.
- **Danger:** absent-orange background for the loud destructive action; a subtler `.btn.danger`
  variant stays neutral at rest and only reveals orange border/text on hover, for row-level
  destructive actions that shouldn't compete with the page's primary action.
- **Icon-only** (`.btn.icon`): same shape family, square padding, 15px inline SVG icons from the
  hand-rolled `Icon` component — no external icon library.

### Cards / Containers
- **Corner Style:** 12px radius.
- **Background:** surface, with a hair border.
- **Shadow Strategy:** the one ambient `--shadow` token (see Elevation & Depth).
- **Border:** 1px hairline.
- **Internal Padding:** 1.25rem, with `.card-head` bleeding to the card edges via negative margin
  and its own bottom hairline.

### Inputs / Fields
- **Style:** surface background, hairline border, 8px radius, 0.5rem/0.75rem padding.
- **Focus:** a 2px solid red outline, 1–2px offset — the same focus treatment used app-wide.
- **Disabled:** 0.5 opacity, `cursor: not-allowed`.

### Pills / Badges
- Fully rounded, no border, 3px/9px padding, 700-weight 11.5px label. Default tone is steel-soft
  background with steel text; semantic variants (`.pill.admin`, `.pill.on`, `.pill.status-*`)
  tint the background toward the relevant brand or status color via `color-mix`, keeping the
  same shape and weight across every variant.

### Navigation / Signature: Pit Board
The **pit board** (`.pit`/`.pit-row`) is the system's signature component: an index number, a
name, and a live mono clock-in duration (`.clock`) with a small pulsing present-colored dot,
shared by the dashboard's "in the shop" list and the kiosk's on-the-clock column. It is the
clearest expression of the control-panel metaphor — a roster that reads like a live status board,
not a table.

### Kiosk
Theme-aware: the kiosk shell, search field, and name/out buttons use the same `--canvas`/
`--surface`/`--surface-2`/`--ink`/`--muted`/`--hair` tokens as the rest of the app, so it follows
light/dark/system like any other page. Search and name buttons stay large (min-height 52–58px) for
touch-first, low-friction use at a shared shop-floor device; focus/hover on kiosk controls switches
the border to red rather than using the app's standard focus-ring treatment, since the kiosk is a
dedicated always-on tablet, not a page a person configures.

## Do's and Don'ts

### Do:
- **Do** keep red to brand + the single primary action per view (The One Red Rule).
- **Do** render every quantitative value — hours, percentages, IDs, durations, timestamps — in
  the mono font with tabular-nums (The Mono-Numbers Rule).
- **Do** reach for the next canvas/surface/surface-2 tonal step before adding a heavier shadow.
- **Do** keep kiosk touch targets large; the kiosk now follows the app's light/dark/system theme.
- **Do** give every interactive control a visible `:focus-visible` outline (inherited from the
  global rule) and respect `prefers-reduced-motion`.

### Don't:
- **Don't** introduce a second loud accent color alongside red; use steel or a status color.
- **Don't** add shadow as a state-change signal (hover/active elevation) — this system's shadow
  is ambient, not structural.
- **Don't** style numeric readouts in the body or display font — that's reserved for the mono
  face.
- **Don't** reintroduce hardcoded hex colors in the kiosk — it themes via tokens now, same as
  every other page.
- **Don't** invent a fifth attendance-status color; present/excused/optional/absent is a closed,
  semantically fixed set.

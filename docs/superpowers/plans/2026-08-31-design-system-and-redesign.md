# Design System + Mission Control Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved "Mission Control" visual direction (colored nav groups, role-tinted avatars, theme-aware kiosk) and formalize the existing CSS-based design system with ~7 thin React primitives, a dev-gated styleguide, and legacy-token cleanup.

**Architecture:** Extend the existing CSS-first system in `globals.css` (tokens + `@layer components`). React primitives in `src/components/ui/` are thin, typed wrappers that emit the existing classes — never a second styling path, so a class change still propagates everywhere. Redesign surfaces (nav, kiosk) are ported from the committed mockup. Presentation-layer only: no schema, data, or server changes.

**Tech Stack:** Next.js (App Router, this repo's forked version — read `node_modules/next/dist/docs/` before writing route/component code), Tailwind CSS v4 (CSS-first, no config file), TypeScript, vitest (logic unit tests), Playwright (UI e2e). Everything runs in Docker via `./dev`.

**Spec:** `docs/superpowers/specs/2026-08-31-design-system-and-redesign-design.md`

## Global Constraints

- **Everything runs in Docker.** Never run `node`/`npm` on the host. Prefix every command with `./dev` (e.g. `./dev npm run typecheck`). App URL for this worktree is `http://localhost:3004` on the host; inside the container it's always `localhost:3000`.
- **Theme tokens are defined in three places** and must stay in sync: light on bare `:root`; dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` AND under `:root[data-theme="dark"] { … }`. Any new token gets all three.
- **Never hardcode a hex a token already names.** Use `var(--*)`. New custom colors go through tokens so both themes track.
- **Primitives are presentational only** — no data fetching, no app/domain coupling. They forward `className` and relevant native props (escape hatch).
- **Primitives emit existing classes** — do not duplicate the CSS into a component; wrap the class.
- **Dev-only routes gate on `VERCEL_ENV`, never `NODE_ENV`** (CI e2e runs `next start` with `NODE_ENV=production`, so a `NODE_ENV` gate would 404 the styleguide in CI). Mirror `src/app/api/dev/onshape-mock/gate.ts`.
- **After any `globals.css` change, regenerate the design-sync stylesheet:** `./dev node .design-sync/build-hub-css.mjs`.
- **After modifying code, run `graphify update .`** to keep the knowledge graph current.
- **Commit at logical checkpoints and push as commits land** (don't batch). Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- **Kiosk (locked):** keep the three-lane layout **Students | On the clock | Mentors** in `KioskBoard.tsx`. Restyle visuals only.
- **Visual source of truth:** `docs/design/mission-control-mockup.html` (open locally; has its own light/dark/system toggle).

---

## Phase 1 — Token & CSS foundation

### Task 1: Colored-nav hue tokens + role-tinted avatar CSS

**Files:**
- Modify: `src/app/globals.css` (token `:root` blocks ×3; `.avatar` rule)
- Regenerate: `.design-sync/hub.css` (via build script)

**Interfaces:**
- Produces: CSS custom properties `--hue-overview`, `--hue-shopfloor`, `--hue-team`, `--hue-admin` (all themes); `.avatar.role-student` / `.avatar.role-mentor` / `.avatar.role-admin` classes. Consumed by Tasks 7, 11, 12.

- [ ] **Step 1: Add the hue tokens to all three token blocks.** In `src/app/globals.css`, in the light `:root` block add:

```css
--hue-overview: var(--red);
--hue-shopfloor: #B45309;
--hue-team: #2563EB;
--hue-admin: #7C3AED;
```

In BOTH dark blocks (`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`) add:

```css
--hue-overview: var(--red);
--hue-shopfloor: #FBBF24;
--hue-team: #60A5FA;
--hue-admin: #A78BFA;
```

- [ ] **Step 2: Add role-tinted avatar variants.** Find the existing `.avatar` rule in the `@layer components` block and add a `border: 1px solid transparent;` to it, then add:

```css
.avatar.role-student { background: color-mix(in srgb, var(--role-student) 20%, var(--surface)); color: var(--role-student); border-color: color-mix(in srgb, var(--role-student) 45%, transparent); }
.avatar.role-mentor  { background: color-mix(in srgb, var(--role-mentor) 20%, var(--surface));  color: var(--role-mentor);  border-color: color-mix(in srgb, var(--role-mentor) 45%, transparent); }
.avatar.role-admin   { background: var(--red); color: var(--red-fg); border-color: transparent; }
```

- [ ] **Step 3: Typecheck + regenerate design-sync.**

Run: `./dev npm run typecheck && ./dev node .design-sync/build-hub-css.mjs`
Expected: typecheck passes; `hub.css` regenerates without error (a `[FONT_REMOTE]` note is expected/informational).

- [ ] **Step 4: Visual sanity check.** Open `http://localhost:3004` and toggle light/dark. Existing avatars using `.avatar` are unchanged (no `role-*` class yet); no visual regression. Confirm the new tokens exist via devtools (`getComputedStyle(document.documentElement).getPropertyValue('--hue-team')` returns a color in both themes).

- [ ] **Step 5: Commit.**

```bash
git add src/app/globals.css .design-sync/hub.css
git commit -m "feat(design): add nav-group hue tokens + role-tinted avatar classes"
git push
```

---

## Phase 2 — React primitives (`src/components/ui/`)

> All primitives are thin wrappers. Each: is a client-agnostic presentational component (no `"use client"` unless it needs interactivity), forwards `className` (merged after the base classes) and rest props to the root element, and emits the existing `globals.css` classes. Verification for the whole phase converges on Task 10 (the `/styleguide` route renders them all, and a Playwright test asserts they mount in both themes).

### Task 2: Scaffold `src/components/ui/` and relocate `Icon`

**Files:**
- Create: `src/components/ui/index.ts` (barrel)
- Move: `src/components/Icon.tsx` → `src/components/ui/Icon.tsx`
- Modify: every importer of `@/components/Icon`

**Interfaces:**
- Produces: `@/components/ui` barrel; `Icon` importable from `@/components/ui`.

- [ ] **Step 1: Move the file.** `git mv src/components/Icon.tsx src/components/ui/Icon.tsx`

- [ ] **Step 2: Find importers.** Run: `./dev bash -c "grep -rl \"components/Icon\" src"` — note every file.

- [ ] **Step 3: Update imports.** Change `@/components/Icon` → `@/components/ui/Icon` in each file found. (Leave the barrel re-export for Step 4.)

- [ ] **Step 4: Create the barrel.** `src/components/ui/index.ts`:

```ts
export { Icon } from "./Icon";
```

- [ ] **Step 5: Typecheck.** Run: `./dev npm run typecheck` — Expected: PASS (no unresolved imports).

- [ ] **Step 6: Commit.**

```bash
git add -A src/components
git commit -m "refactor(ui): create src/components/ui and move Icon into it"
git push
```

### Task 3: `Button` primitive

**Files:**
- Create: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- Produces: `Button` — `props: { variant?: 'primary'|'secondary'|'danger'; icon?: boolean; pending?: boolean; pendingLabel?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>`. When `pending`, the button is `disabled` and shows `pendingLabel ?? children`.

- [ ] **Step 1: Write the component.** `src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  danger: "btn btn-danger",
};

export function Button({
  variant = "primary",
  icon = false,
  pending = false,
  pendingLabel,
  className = "",
  children,
  disabled,
  ...rest
}: {
  variant?: Variant;
  icon?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [VARIANT_CLASS[variant], icon ? "icon" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={disabled || pending} {...rest}>
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
```

- [ ] **Step 2: Export it.** Add `export { Button } from "./Button";` to `src/components/ui/index.ts`.

- [ ] **Step 3: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/Button.tsx src/components/ui/index.ts
git commit -m "feat(ui): add Button primitive"
git push
```

### Task 4: `Field` primitive

**Files:**
- Create: `src/components/ui/Field.tsx`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- Produces: `Field` — `props: { label: string; htmlFor?: string; error?: string; children: ReactNode }`. Renders `.label` + children (the control, styled `.field`/`.input` by the caller) + optional error text with `role="alert"`; wires `aria-describedby` when `error` present and `htmlFor` given.

- [ ] **Step 1: Write the component.** `src/components/ui/Field.tsx`:

```tsx
import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined;
  return (
    <label className="label" htmlFor={htmlFor}>
      {label}
      {children}
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
```

- [ ] **Step 2: Add a `.field-error` class to `globals.css`** (small, in `@layer components`): red text, small size, uses `var(--red)`:

```css
.field-error { display: block; margin-top: 4px; font-size: 12px; color: var(--red); }
```

- [ ] **Step 3: Export it.** Add `export { Field } from "./Field";` to the barrel.

- [ ] **Step 4: Typecheck + lint + regenerate hub.css** (globals.css changed).

Run: `./dev npm run typecheck && ./dev npm run lint && ./dev node .design-sync/build-hub-css.mjs`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/Field.tsx src/components/ui/index.ts src/app/globals.css .design-sync/hub.css
git commit -m "feat(ui): add Field primitive + .field-error class"
git push
```

### Task 5: `Card` primitive (+ `Card.Head`)

**Files:** Create `src/components/ui/Card.tsx`; Modify barrel.

**Interfaces:**
- Produces: `Card` (`.card`) and `Card.Head` (`.card-head`), both `div` wrappers forwarding `className`/rest.

- [ ] **Step 1: Write the component.**

```tsx
import type { HTMLAttributes } from "react";

function cx(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card", className)} {...rest} />;
}

function Head({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card-head", className)} {...rest} />;
}

Card.Head = Head;
```

- [ ] **Step 2: Export it.** Add `export { Card } from "./Card";` to the barrel.
- [ ] **Step 3: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/Card.tsx src/components/ui/index.ts
git commit -m "feat(ui): add Card primitive"
git push
```

### Task 6: `Pill` primitive

**Files:** Create `src/components/ui/Pill.tsx`; Modify barrel.

**Interfaces:**
- Produces: `Pill` — `props: { tone?: 'role'|'admin'|'on'|'off'|'status-present'|'status-excused'|'status-optional'|'status-absent' } & span attrs`. Emits `.pill` + the tone class (tone strings map 1:1 to existing pill modifier classes in `globals.css`).

- [ ] **Step 1: Write the component.**

```tsx
import type { HTMLAttributes } from "react";

type Tone =
  | "role" | "admin" | "on" | "off"
  | "status-present" | "status-excused" | "status-optional" | "status-absent";

export function Pill({
  tone,
  className = "",
  ...rest
}: { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  const cls = ["pill", tone ?? "", className].filter(Boolean).join(" ");
  return <span className={cls} {...rest} />;
}
```

- [ ] **Step 2: Verify tone classes exist.** Run: `./dev bash -c "grep -nE '\\.pill\\.(role|admin|on|off|status-)' src/app/globals.css"` — confirm each tone maps to a real class. If any tone string doesn't match the actual class name, fix the union to match `globals.css` (do not invent classes).
- [ ] **Step 3: Export it.** Add to barrel.
- [ ] **Step 4: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/Pill.tsx src/components/ui/index.ts
git commit -m "feat(ui): add Pill primitive"
git push
```

### Task 7: `Avatar` primitive (role-tinted)

**Files:** Create `src/components/ui/Avatar.tsx`; Modify barrel.

**Interfaces:**
- Consumes: `.avatar.role-*` classes from Task 1.
- Produces: `Avatar` — `props: { initials: string; role?: 'student'|'mentor'|'admin' } & span attrs`. Emits `.avatar` + `role-<role>`; `aria-hidden` unless caller overrides.

- [ ] **Step 1: Write the component.**

```tsx
import type { HTMLAttributes } from "react";

export function Avatar({
  initials,
  role,
  className = "",
  ...rest
}: { initials: string; role?: "student" | "mentor" | "admin" } & HTMLAttributes<HTMLSpanElement>) {
  const cls = ["avatar", role ? `role-${role}` : "", className].filter(Boolean).join(" ");
  return (
    <span className={cls} aria-hidden="true" {...rest}>
      {initials}
    </span>
  );
}
```

- [ ] **Step 2: Export it.** Add to barrel.
- [ ] **Step 3: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/Avatar.tsx src/components/ui/index.ts
git commit -m "feat(ui): add role-tinted Avatar primitive"
git push
```

### Task 8: `Stat` primitive

**Files:** Create `src/components/ui/Stat.tsx`; Modify barrel.

**Interfaces:**
- Produces: `Stat` — `props: { label: string; value: ReactNode; bar?: number /* 0..1 */ }`. Emits `.stat` markup matching the existing class structure; when `bar` given, renders the `.bar` goal meter at that fraction.

- [ ] **Step 1: Read the existing `.stat`/`.bar` markup contract.** Run: `./dev bash -c "grep -nA6 '\\.stat' src/app/globals.css | head -40"` and grep an existing `.stat` usage in `src/` to copy the exact inner element structure (e.g. `<div class="stat"><span class="mono">…</span>…`). Match it exactly.
- [ ] **Step 2: Write the component** to emit that exact structure, with the label, the value wrapped in `.mono`, and (if `bar != null`) a `.bar` element whose fill width is `Math.round(bar*100)%`. Clamp `bar` to `[0,1]`.
- [ ] **Step 3: Export it.** Add to barrel.
- [ ] **Step 4: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/Stat.tsx src/components/ui/index.ts
git commit -m "feat(ui): add Stat primitive"
git push
```

### Task 9: `TableWrap` primitive

**Files:** Create `src/components/ui/TableWrap.tsx`; Modify barrel.

**Interfaces:**
- Produces: `TableWrap` — wraps children in the `.tablewrap` (`overflow-x-auto`) shell so wide tables scroll on narrow viewports. `props: { children } & div attrs`.

- [ ] **Step 1: Write the component.**

```tsx
import type { HTMLAttributes } from "react";

export function TableWrap({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  const cls = ["tablewrap", className].filter(Boolean).join(" ");
  return <div className={cls} {...rest} />;
}
```

- [ ] **Step 2: Export it.** Add to barrel.
- [ ] **Step 3: Typecheck + lint.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/TableWrap.tsx src/components/ui/index.ts
git commit -m "feat(ui): add TableWrap primitive"
git push
```

### Task 10: Dev-gated `/styleguide` route + gate test

**Files:**
- Create: `src/app/styleguide/gate.ts`
- Create: `src/app/styleguide/gate.test.ts`
- Create: `src/app/styleguide/page.tsx`
- Create: `e2e/styleguide.spec.ts`

**Interfaces:**
- Consumes: all primitives from Tasks 3–9.
- Produces: `styleguideBlocked(): boolean` (true when the route must 404); a `/styleguide` page rendering every primitive/variant.

- [ ] **Step 1: Write the failing gate test.** `src/app/styleguide/gate.test.ts` (mirror `src/app/api/dev/onshape-mock/gate.test.ts`):

```ts
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { styleguideBlocked } from "./gate";

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("styleguideBlocked", () => {
  test("Vercel production is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(styleguideBlocked()).toBe(true);
  });
  test("Vercel preview is blocked", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(styleguideBlocked()).toBe(true);
  });
  test("local dev is allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(styleguideBlocked()).toBe(false);
  });
  test("non-Vercel next start (CI e2e) is allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(styleguideBlocked()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `./dev npx vitest run src/app/styleguide/gate.test.ts` — Expected: FAIL (`styleguideBlocked` not defined).

- [ ] **Step 3: Write the gate.** `src/app/styleguide/gate.ts`:

```ts
// The styleguide is a dev/preview tool; it must never render in real prod.
// Gate on VERCEL_ENV (unforgeable) — NOT NODE_ENV, which is "production" under
// `next start` in CI e2e where we DO want the route reachable.
export function styleguideBlocked(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  return vercelEnv === "production" || vercelEnv === "preview";
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run: `./dev npx vitest run src/app/styleguide/gate.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the page.** `src/app/styleguide/page.tsx` — a server component that calls `notFound()` when `styleguideBlocked()`, otherwise renders a section per primitive showing every variant (Buttons: primary/secondary/danger/icon/pending; Card + Card.Head; Field with and without error; Pill each tone; Avatar each role; Stat with and without bar; TableWrap around a small `.table`). Import from `@/components/ui`. Use `import { notFound } from "next/navigation"`. Read the App-Router page/`notFound` guide in `node_modules/next/dist/docs/` first if unsure of the current API.

- [ ] **Step 6: Write the e2e.** `e2e/styleguide.spec.ts` — mirror an existing spec's structure (see `e2e/first-status.spec.ts` for setup). Navigate to `/styleguide`; assert a primary button and a role-admin avatar are visible; then set the theme to dark (add `data-theme="dark"` on `<html>` via `page.evaluate`) and assert the page still renders (a token-driven color differs). Keep it a smoke test, not pixel-perfect.

- [ ] **Step 7: Run typecheck, unit, e2e.**

Run: `./dev npm run typecheck && ./dev npx vitest run src/app/styleguide/gate.test.ts && ./dev npx playwright test e2e/styleguide.spec.ts`
Expected: all PASS.

- [ ] **Step 8: Manual check.** Open `http://localhost:3004/styleguide`, toggle light/dark — every primitive renders correctly in both themes.

- [ ] **Step 9: Commit.**

```bash
git add src/app/styleguide e2e/styleguide.spec.ts
git commit -m "feat(ui): dev-gated /styleguide route rendering all primitives"
git push
```

---

## Phase 3 — Redesign surfaces

### Task 11: `SiteNav` → grouped left sidebar with colored groups + flyouts (desktop)

**Files:**
- Modify: `src/components/SiteNav.tsx`
- Modify: `src/app/globals.css` (sidebar/rail/flyout classes ported from the mockup)
- Modify: `src/components/AppChrome.tsx` / `src/app/layout.tsx` if the shell layout must change from top-bar to sidebar (check how `SiteNav` is mounted first)
- Reference: `docs/design/mission-control-mockup.html`

**Interfaces:**
- Consumes: `--hue-*` tokens + `--grp` pattern from Task 1.
- Produces: the new grouped sidebar nav. Nav item → group mapping (role-gating unchanged from current `SiteNav`): **Overview**: Home, Leaderboard. **Shop floor**: Kiosk, Shop. **Team**: People, Teams, Events. **Admin**: Admin.

- [ ] **Step 1: Read the mockup's sidebar CSS + markup.** Open `docs/design/mission-control-mockup.html`; locate the sidebar (`.sb-group`, `.sbi`, `.sbi.active`, `.ic`), icon rail (`.rail-i`), and flyout (`.flyout`/`.rail-fly`, `.fly-title`) rules and their `--grp` usage. These are the exact styles to port.
- [ ] **Step 2: Port the sidebar/rail/flyout CSS** into `globals.css` `@layer components`, adapting to the token names already in the file. Each group container sets `style={{ ["--grp" as string]: "var(--hue-overview)" }}` (etc.). Keep flyouts CSS-only (`:hover`/`:focus-within`), `Tab`-reachable, no JS.
- [ ] **Step 3: Rebuild `SiteNav.tsx`** to emit the grouped structure. Preserve every current behavior: role gating via `hasRole`, kiosk-cookie link logic, the viewer/initials block, sign-out form, `ThemeToggle`. Group items per the mapping above; set `--grp` per group. People/Events/Admin get flyout children (Admin's subpages — enumerate from `/admin`); Home/Leaderboard/Kiosk/Shop/Teams stay flat.
- [ ] **Step 4: Confirm the shell still composes.** Check `layout.tsx`/`AppChrome.tsx` — if the app was a top-bar layout and is now a sidebar, adjust the flex/grid wrapper so `#main` sits beside the sidebar on desktop. The `/onshape` panel omission in `AppChrome` must still work.
- [ ] **Step 5: Typecheck + lint + regenerate hub.css.**

Run: `./dev npm run typecheck && ./dev npm run lint && ./dev node .design-sync/build-hub-css.mjs`
Expected: PASS.

- [ ] **Step 6: e2e — nav still works.** Run the existing auth/nav e2e that exercises navigation (e.g. `./dev npx playwright test e2e/auth-gating.spec.ts`). Expected: PASS (links still reachable by role). Fix selectors in `SiteNav` if a test targets a link that moved, but do not weaken an authz assertion.
- [ ] **Step 7: Manual check.** At `http://localhost:3004`, log in as Admin (dev-login). Verify: four groups with their signature hues on header/icon/active tick; flyouts open on hover AND keyboard focus; both themes; AA-legible.
- [ ] **Step 8: Commit.**

```bash
git add src/components/SiteNav.tsx src/app/globals.css src/components/AppChrome.tsx src/app/layout.tsx .design-sync/hub.css
git commit -m "feat(nav): grouped left sidebar with colored groups and flyout submenus"
git push
```

### Task 12: Mobile bottom tab bar + "More" sheet

**Files:**
- Modify: `src/components/SiteNav.tsx` (or a new `src/components/ui/MobileNav.tsx` client component if interactivity is needed for the sheet)
- Modify: `src/app/globals.css`
- Reference: `docs/design/mission-control-mockup.html`

**Interfaces:**
- Consumes: same nav item set + `--hue-*` as Task 11.
- Produces: a bottom tab bar (4 primary tabs + "More") shown at mobile width; the sidebar is hidden at that breakpoint.

- [ ] **Step 1: Read the mockup's bottom-bar + More-sheet CSS/markup** (`.tabbar`, `.tab`, the More sheet). Note the breakpoint it uses.
- [ ] **Step 2: Port the CSS** into `globals.css`, hiding the sidebar and showing the tab bar below the breakpoint (and vice-versa above). Reuse the `--hue-*` icon tints from the mockup's More-sheet items.
- [ ] **Step 3: Implement the markup.** If the "More" sheet needs open/close state, create a small `"use client"` component; otherwise a CSS `:target` or `<details>` approach is fine (prefer no-JS). Pick the 4 primary tabs (Home, Kiosk or People by role, Events/Teams, Leaderboard) and put the rest under More.
- [ ] **Step 4: Typecheck + lint + regenerate hub.css.** Run: `./dev npm run typecheck && ./dev npm run lint && ./dev node .design-sync/build-hub-css.mjs` — Expected: PASS.
- [ ] **Step 5: Manual check at mobile width.** In the browser devtools responsive mode (or resize), confirm: sidebar hidden, bottom bar shown, More sheet opens, both themes, tap targets ≥44px.
- [ ] **Step 6: Commit.**

```bash
git add -A src/components src/app/globals.css .design-sync/hub.css
git commit -m "feat(nav): mobile bottom tab bar + More sheet"
git push
```

### Task 13: Theme-aware kiosk (keep three lanes)

**Files:**
- Modify: `src/app/globals.css` (the `.kiosk*` block, ~L1036+)
- Verify only (no structural change): `src/components/KioskBoard.tsx`

**Interfaces:**
- Produces: kiosk styles that follow light/dark/system via tokens. No API/prop changes to `KioskBoard`.

- [ ] **Step 1: Locate the hardcoded hex.** Run: `./dev bash -c "grep -nE '#[0-9a-fA-F]{3,6}' src/app/globals.css | grep -i kiosk"` and read the whole `.kiosk*` block. Inventory every hardcoded color (`#101114`, `#f3f1ec`, `#23262c`, `#9aa0a8`, `#e01926`, …).
- [ ] **Step 2: Replace hex with tokens.** Map: page bg → `var(--canvas)`; card/surface → `var(--surface)`; text → `var(--ink)`; secondary text → `var(--muted)`; borders → `var(--hair)`; red accents → `var(--red)`/`var(--red-fg)`. Do NOT touch the `.hazard` stripe's intentional red. Keep the three-lane grid (`.k-students`/`.k-mentors` + "On the clock") exactly as-is — only colors change.
- [ ] **Step 3: Typecheck + regenerate hub.css.** Run: `./dev npm run typecheck && ./dev node .design-sync/build-hub-css.mjs` — Expected: PASS.
- [ ] **Step 4: e2e — kiosk still renders its lanes.** Run the kiosk e2e if one exists (`./dev bash -c "ls e2e | grep -i kiosk"`; run it). Expected: PASS. If none exists, skip (don't invent one here).
- [ ] **Step 5: Manual check.** Open the kiosk (`/kiosk`) at `http://localhost:3004` in BOTH themes. Confirm: three lanes intact (Students | On the clock | Mentors), readable in light and dark, no leftover dark-only hex, no theme flash on load. Assess across-the-room readability of the light theme (spec open question — if it reads poorly, note it in the PR; do not change scope here).
- [ ] **Step 6: Commit.**

```bash
git add src/app/globals.css .design-sync/hub.css
git commit -m "feat(kiosk): make kiosk theme-aware (was committed-dark); keep 3-lane layout"
git push
```

---

## Phase 4 — Adoption & cleanup

### Task 14: Migrate hand-rolled button stragglers → `Button`

**Files:**
- Modify: the ~10 files with hand-rolled button/link markup (identify in Step 1)

**Interfaces:**
- Consumes: `Button` (Task 3).

- [ ] **Step 1: Find the stragglers.** Run: `./dev bash -c "grep -rlE '<(button)[^>]*className=\"[^\"]*(rounded|px-|py-)' src --include=*.tsx"`. For each, decide: is it a standard action button? If yes → migrate. If it's a bespoke control (toggle, tab, nav link with unique styling) → leave it and note why.
- [ ] **Step 2: Migrate each qualifying button** to `<Button variant=…>`, preserving `onClick`, `type`, `disabled`, and any in-flight logic (convert manual "Saving…" swaps to the `pending`/`pendingLabel` props). One file at a time.
- [ ] **Step 3: Typecheck + lint after each.** Run: `./dev npm run typecheck && ./dev npm run lint` — Expected: PASS.
- [ ] **Step 4: e2e sanity.** Run the e2e suites touching the migrated surfaces (e.g. admin-crud if an admin button changed). Expected: PASS.
- [ ] **Step 5: Commit** (may be a few commits, grouped by area).

```bash
git add -A src
git commit -m "refactor(ui): adopt Button primitive for hand-rolled buttons"
git push
```

### Task 15: Retire legacy `--color-*` token aliases

**Files:**
- Modify: `src/app/globals.css` (remove the alias block)
- Modify: any files still referencing `--color-*` or `var(--color-…)`

**Interfaces:** none (pure cleanup).

- [ ] **Step 1: Find all users.** Run: `./dev bash -c "grep -rnE 'color-(brand|surface|present|excused|optional|absent|ink|muted|hair)' src"` (adjust to the actual alias names in `globals.css`). List both CSS and TSX (`text-[var(--color-brand)]` etc.) references.
- [ ] **Step 2: Replace each** with the short token name (`--color-brand` → `--red`, etc. — map exactly per the alias definitions in `globals.css`).
- [ ] **Step 3: Remove the alias block** from `globals.css`.
- [ ] **Step 4: Grep to confirm zero remaining.** Run: `./dev bash -c "grep -rn 'var(--color-' src && echo FOUND || echo clean"` — Expected: `clean`.
- [ ] **Step 5: Typecheck + lint + regenerate hub.css + full unit + e2e.** Run: `./dev npm run typecheck && ./dev npm run lint && ./dev node .design-sync/build-hub-css.mjs && ./dev npm run test` — Expected: PASS.
- [ ] **Step 6: Manual spot-check** a few pages in both themes for any color regression.
- [ ] **Step 7: Commit.**

```bash
git add -A src .design-sync/hub.css
git commit -m "refactor(design): retire legacy --color-* token aliases"
git push
```

### Task 16: Docs, design-sync, and final verification

**Files:**
- Modify: `docs/design/ui-system.md`
- Modify: `.design-sync/conventions.md`
- Modify: `.design-sync/NOTES.md` (reverse the "kiosk committed-dark" watch-list line)
- Regenerate: `.design-sync/hub.css`

- [ ] **Step 1: Update `docs/design/ui-system.md`:** document `src/components/ui/` + each primitive; the `--hue-*` nav tokens + `--grp` pattern; role-tinted avatars; the now-theme-aware kiosk (remove the "intentionally hardcoded dark" sentence); point the "visual source of truth" at the `/styleguide` route (with `docs/design/mission-control-mockup.html` as the static reference).
- [ ] **Step 2: Update `.design-sync/conventions.md`:** add the primitives to the component section and the `--hue-*` tokens to the tokens section.
- [ ] **Step 3: Update `.design-sync/NOTES.md`:** change the "Kiosk classes are committed-dark by design — don't fix them" line to record that the kiosk is now theme-aware as of this work.
- [ ] **Step 4: Final design-sync regen.** Run: `./dev node .design-sync/build-hub-css.mjs`.
- [ ] **Step 5: Update the graph.** Run: `./dev bash -c "graphify update ."` (or the documented invocation).
- [ ] **Step 6: Full pre-PR gate.** Run, and confirm all pass:

```bash
./dev npm run lint && ./dev npm run typecheck && ./dev npm run test && ./dev npm run e2e
```

- [ ] **Step 7: Commit.**

```bash
git add docs/design/ui-system.md .design-sync/conventions.md .design-sync/NOTES.md .design-sync/hub.css graphify-out
git commit -m "docs(design): document primitives, hue tokens, theme-aware kiosk; refresh design-sync"
git push
```

- [ ] **Step 8: Open the PR.** `gh pr create` against `master`; title "Design system + Mission Control redesign (#213)"; body summarizing the redesign + primitives, linking the spec, and noting the kiosk-default-theme open question for reviewer input. Report the URL.

---

## Notes for the executor

- **Read the forked Next.js docs** (`node_modules/next/dist/docs/`) before writing route/component code — this repo's Next.js differs from training data (see AGENTS.md).
- **The mockup is the visual truth** for Tasks 11–12; port its CSS rather than reinventing layout.
- **Every `globals.css` change** ends with a `hub.css` regen (batched per commit is fine).
- **Don't weaken authz/e2e assertions** to make a moved selector pass — update the selector, keep the assertion.
- **Kiosk lanes are locked** — visual-only changes in Task 13.

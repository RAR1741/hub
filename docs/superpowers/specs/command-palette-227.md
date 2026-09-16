# Command palette (⌘K) — nav + people search — design (#227)

> File named per the orchestrator's brief. Folder convention is
> `YYYY-MM-DD-<name>-design.md`; rename to `2026-09-07-command-palette-design.md`
> at the human gate if preferred.

## 1. Problem & constraints

Add a ⌘K / Ctrl+K command palette in the desktop top bar (`docs/design/mission-control-mockup.html`,
the `.tb-search` slot) that does two things: jump to any nav destination the viewer is allowed to
see, and live-search people (mentor+) and jump to their profile.

Decisions already made (not relitigated here): scope is nav **and** people search in one PR; the
palette primitive is the `cmdk` library (new dependency).

Constraints that shape the design:

- `SiteTopbar` and `SiteNav` (`src/components/`) are **async server components**; the palette
  (keyboard handling, open state, fetch) must be a client component. Client props must be
  serializable.
- Role gating is server-side everywhere today; a mentor's HTML/RSC payload must never contain an
  admin-only href (`SiteNav.tsx` comment on `ADMIN_ITEMS`; `e2e/auth-gating.spec.ts` asserts
  `a[href="/admin/people"]` count 0 for a mentor).
- `src/app/route-auth-allowlist.test.ts` fails the suite for any `route.ts` that does not export
  a handler in the literal form `export const GET = withRole(` (or `withRole<`). New API routes
  use that exact shape.
- GET handlers are read-only (CSRF posture: `sameSite=lax` + non-simple mutation methods). A
  search GET is fine.
- Vitest only includes `src/**/*.test.ts` (no jsdom, no `.tsx`) — component unit tests are not an
  option; UI coverage is Playwright. E2E signs in via `e2e/helpers/session.ts` cookies, never the
  dev-login form.
- Theme-aware CSS via existing tokens in `src/app/globals.css` (`--canvas --surface --surface-2
  --ink --muted --hair --shadow --red`). The mockup's `--sunken` token does not exist here.
- `.topbar` is `display:none` below 768px and in print.
- Everything runs in Docker: `./dev npm install cmdk`, never host `npm`.
- Modified Next.js (16.3.0): consult `node_modules/next/dist/docs/01-app/...` for
  `useRouter`/client-component rules (`01-getting-started/04-linking-and-navigating.md`,
  `05-server-and-client-components.md`). Nothing exotic is needed: `"use client"`, serializable
  props, `useRouter().push`.

## 2. Chosen approach

### 2.1 Component architecture

```
src/lib/nav-destinations.ts          NEW  pure module: the ONE role-gated destination list
src/lib/nav-destinations.test.ts     NEW  unit tests
src/components/CommandPalette.tsx    NEW  "use client": trigger button + cmdk dialog + ⌘K listener
src/app/api/people/search/route.ts   NEW  GET, withRole("mentor")
src/app/api/people/search/route.test.ts NEW
src/components/SiteTopbar.tsx        EDIT server: compute props, mount <CommandPalette/>
src/components/SiteNav.tsx           EDIT server: consume nav-destinations (swap booleans for lookups)
src/app/globals.css                  EDIT .tb-search trigger + palette styles
e2e/command-palette.spec.ts          NEW
docs/features.md                     EDIT catalog bullet
package.json / package-lock.json     EDIT cmdk
```

**Mount point: `SiteTopbar`** (server) renders `<CommandPalette destinations={...}
canSearchPeople={...} />` as the first child of `<header className="topbar">`, before
`.tb-actions`. `CommandPalette` renders both the `.tb-search` trigger button (in place, in the
topbar) and the `cmdk` dialog (portaled to `<body>` by Radix Dialog inside cmdk — coder verifies,
see §2.4). One instance per page; no context, no store, no custom events.

Server → client data flow (all computed on the server, all serializable):

```ts
// SiteTopbar.tsx (server)
const token = (await cookies()).get(KIOSK_COOKIE)?.value;
const [viewer, kioskRegistered] = await Promise.all([getViewer(), verifyKioskToken(token)]);
const destinations = navDestinations({ role: viewer.role, kioskRegistered });
const canSearchPeople = hasRole(viewer.role, "mentor");
// ...
<header className="topbar">
  <CommandPalette destinations={destinations} canSearchPeople={canSearchPeople} />
  <div className="tb-actions">…unchanged…</div>
</header>
```

`kioskRegistered` mirrors `SiteNav` exactly so the Kiosk destination shows for a registered
tablet's guest just like the sidebar link does (`verifyKioskToken` short-circuits with no DB hit
when there is no cookie). `getViewer()` running in both `SiteNav` and `SiteTopbar` is pre-existing
and unchanged.

The viewer's role itself is **not** passed to the client — only its consequences (the filtered
list and one boolean). Nothing in the client bundle makes a gating decision.

Why not mount once in `layout.tsx` like `SidebarKeyShortcut`? The palette needs viewer-derived
props, and `layout.tsx` already delegates viewer work to `SiteTopbar`/`SiteNav`. Mounting in
`SiteTopbar` is where the trigger has to live anyway, and avoids a second server→client seam plus
trigger↔dialog cross-component wiring.

### 2.2 Destination-list sourcing (shared module)

`src/lib/nav-destinations.ts` — pure, no server imports (importable from tests, `SiteNav`,
`SiteTopbar`):

```ts
import type { Role } from "./types";
import { hasRole } from "./authz";

export type NavGroup = "Overview" | "Shop floor" | "Team" | "Admin";

/** Who may see a destination. A Role means hasRole(viewer, role) ("student" = any signed-in
 *  person, since hasRole ranks mentor/admin above student). "kiosk" = mentor+ OR the request
 *  carries a registered kiosk-device cookie (the Kiosk link's existing rule). */
export type NavGate = Role | "kiosk";

export type NavDestination = {
  label: string;
  href: string;
  group: NavGroup;
  gate: NavGate;
};

export type NavContext = { role: Role; kioskRegistered: boolean };

/** Every destination the app has, ungated. Order = display order within a group. */
export const NAV_ITEMS: readonly NavDestination[] = [
  { label: "Home",        href: "/",            group: "Overview",   gate: "guest" },
  { label: "Leaderboard", href: "/leaderboard", group: "Overview",   gate: "guest" },
  { label: "Kiosk",       href: "/kiosk",       group: "Shop floor", gate: "kiosk" },
  { label: "Shop",        href: "/shop",        group: "Shop floor", gate: "student" },
  { label: "Batteries",   href: "/batteries",   group: "Shop floor", gate: "student" },
  { label: "Tools",       href: "/tools",       group: "Shop floor", gate: "student" },
  { label: "People",      href: "/people",      group: "Team",       gate: "mentor" },
  { label: "Duplicates",  href: "/admin/people/duplicates", group: "Team", gate: "admin" },
  { label: "Import CSV",  href: "/admin/people/import",     group: "Team", gate: "admin" },
  { label: "Teams",       href: "/teams",       group: "Team",       gate: "student" },
  { label: "Events",      href: "/events",      group: "Team",       gate: "student" },
  { label: "Calendar",    href: "/calendar",    group: "Team",       gate: "mentor" },
  { label: "Admin",       href: "/admin",       group: "Admin",      gate: "mentor" },
  // ADMIN_ITEMS moved verbatim from SiteNav.tsx (same order, same roles), each with
  // group: "Admin" and gate: <its former role>. Keep the section comments.
  { label: "Requests",    href: "/admin/requests", group: "Admin",   gate: "mentor" },
  // … Flagged sessions, Reports, People, Teams, Badges, Time import, Application import,
  //   Meetings, Build days, Sessions, Events, Forms, Parts, Periods, Kiosk devices,
  //   Drive group sync, GitHub team sync, FIRST roster status, Slack, Settings, Cron jobs
];

export function isAllowed(item: NavDestination, ctx: NavContext): boolean {
  if (item.gate === "kiosk") return ctx.kioskRegistered || hasRole(ctx.role, "mentor");
  return hasRole(ctx.role, item.gate);
}

/** The role-gated destination list. Filter here, on the server, before anything is serialized. */
export function navDestinations(ctx: NavContext): NavDestination[] {
  return NAV_ITEMS.filter((item) => isAllowed(item, ctx));
}
```

Label collisions are real and intended ("People" `/people` vs "People" `/admin/people`; "Teams",
"Events" likewise) — the palette shows the group heading so they are distinguishable, and
`href` is the unique key. The unit test asserts href uniqueness, not label uniqueness.

**`SiteNav` refactor — mechanical, no JSX restructuring.** The shipped nav's structure (groups,
flyouts, rail, tab bar, More sheet) stays as is. Only the *conditions* change: every
`isStudent && …` / `isMentor && …` / `(isStudent || isMentor || isAdmin) && …` link guard becomes
a lookup on the shared list, so the two surfaces cannot disagree.

```ts
// SiteNav.tsx
import { navDestinations } from "@/lib/nav-destinations";
// delete the local ADMIN_ITEMS constant
const dest = navDestinations({ role, kioskRegistered });
const can = (href: string) => dest.some((d) => d.href === href);

const adminItems  = dest.filter((d) => d.group === "Admin" && d.href !== "/admin");
const peopleItems = [
  { label: "All people", href: "/people" },
  ...dest.filter((d) => d.group === "Team" && d.href.startsWith("/admin/people/")),
];
const eventsItems = [
  { label: "Upcoming", href: "/events" },
  ...dest.filter((d) => d.href === "/calendar"),
];
const showShopFloor = can("/kiosk") || can("/shop");          // was isMentor || kioskRegistered || isStudent
const showTeam      = can("/people") || can("/teams");        // was isMentor || isStudent
// mobile primaries:
const shopPrimary = can("/kiosk") ? {Kiosk…} : can("/shop") ? {Shop…} : null;
const teamPrimary = can("/people") ? {People…} : can("/teams") ? {Teams…} : null;
```

and in JSX: `{(isMentor || kioskRegistered) && <NavLink href="/kiosk">` → `{can("/kiosk") && …}`,
`{isStudent && <NavLink href="/shop">` → `{can("/shop") && …}`, and so on for every link in
`.sb`, `.rail`, and the More sheet. `isMentor` may remain **only** for the Admin *group*
wrapper (`can("/admin")` is equivalent — use that) and `viewer.person` for the Sign out/Sign in
row (identity, not navigation). After the refactor `isStudent`/`isAdmin` should be unused and
deleted; `isMentor` should be gone too (replaced by `can("/admin")`). If any remain, the coder
explains why in the commit message.

Truth table the refactor must preserve (this is also the unit-test matrix):

| viewer | sees |
| --- | --- |
| guest, no kiosk cookie | Home, Leaderboard |
| guest, registered kiosk | + Kiosk |
| student | Home, Leaderboard, Shop, Batteries, Tools, Teams, Events |
| mentor | student set + Kiosk, People, Calendar, Admin, and Admin items gated `mentor` (Requests, Flagged sessions, Reports, Build days, Sessions, Events, Forms, Parts); **not** `/admin/people`, `/admin/teams`, `/admin/meetings`, `/admin/periods`, `/admin/kiosk-devices`, `/admin/drive-sync`, `/admin/settings`, Duplicates, Import CSV |
| admin | everything |

### 2.3 People search

**Endpoint:** `GET /api/people/search?q=<text>` — `src/app/api/people/search/route.ts`

```ts
import { withRole } from "@/lib/api";
import { displayName, listPeople } from "@/lib/people";

const LIMIT = 8;
const MAX_Q = 80;

export const GET = withRole("mentor", async (_viewer, request) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, MAX_Q);
  if (!q) return Response.json({ people: [] });          // never dump the roster on blank input
  const rows = await listPeople(q);
  const people = rows
    .sort((a, b) => Number(b.is_active) - Number(a.is_active)) // stable: keeps last_name order within each half
    .slice(0, LIMIT)
    .map((r) => ({ id: r.id, name: displayName(r), role: r.role, isActive: r.is_active, gradYear: r.grad_year }));
  return Response.json({ people });
});
```

- **Role gate:** `mentor` — identical to `/people` (`src/app/people/page.tsx` redirects
  non-mentors) and to `canViewProfile` for other people's profiles. Students/guests get 403 and the
  client never calls it (`canSearchPeople=false`). A masquerading admin sees the target's role, so
  masquerading as a student hides people search — correct (masquerade shows what the student sees;
  `withRole` already permits GET while masquerading).
- **Query:** reuses `listPeople(q)` (`src/lib/people.ts`) — the existing `first_name / last_name /
  display_name` ilike search with PostgREST-injection quoting already in place. No new query, no
  schema change, no new lib function. Slice in the route (`ponytail:` roster is a few hundred rows;
  add `.limit()` to `listPeople` if it ever matters).
- **Response is the PII boundary.** Exactly `{ people: { id, name, role, isActive, gradYear }[] }`.
  No email, phone, address, DOB, or any other `person` column. The route test asserts the exact key
  set. Inactive people are included (alumni lookup is a real use) but sorted after active and
  rendered with a muted "inactive" tag.
- **Pre-existing debt, out of scope:** `listPeople` does not check `error` on its select (repo rule
  says always check). It has 10 callers; changing it to throw is a behavior change beyond this PR.
  Noted so a reviewer does not rediscover it.
- **Client fetch:** in `CommandPalette`, `useEffect` on `[query, open, canSearchPeople]`: skip
  when `!canSearchPeople || !open || !query.trim()` (clear results, `searching=false`); otherwise
  `const t = setTimeout(150ms)` whose callback sets `searching=true` and runs
  `fetch(\`/api/people/search?q=${encodeURIComponent(q)}\`, { signal })`, setting results and
  `searching=false` when the response lands (or on abort/error). Effect cleanup does
  `clearTimeout(t); controller.abort()` — so a keystroke cancels both the pending timer and any
  in-flight request, and stale responses can never land out of order. Non-OK → treat as empty.
  That is the whole debounce.
- **Result → navigation:** `router.push(\`/people/${id}\`)` then close (same target as the People
  browser's name cell and the topbar's own identity link).

### 2.4 cmdk integration

**Package:** `cmdk` (latest 1.x), installed with `./dev npm install cmdk`. cmdk bundles
`@radix-ui/react-dialog` for `Command.Dialog`. Peer deps must accept `react 19.2.8` — the install
task fails loudly on peer warnings rather than using `--legacy-peer-deps`.

**Coder verifies every cmdk API claim below against `node_modules/cmdk/dist/index.d.ts` (and the
README) after install — this spec was written without the package on disk:**

- `Command.Dialog` props `open`, `onOpenChange`, `label`, `overlayClassName`, `contentClassName`;
  that it renders through a Radix `Portal` to `<body>` (required — see mobile note in §4/§7).
- `Command` prop `shouldFilter`; `Command.Item` props `value`, `onSelect`; `Command.Group` prop
  `heading`; `Command.Empty`; `Command.Input` `value`/`onValueChange`.
- Rendered attributes used by the CSS: `[cmdk-root]`, `[cmdk-input]`, `[cmdk-list]`,
  `[cmdk-group-heading]`, `[cmdk-item]`, `[cmdk-item][data-selected="true"]`, `[cmdk-empty]`.
- Radix `Dialog.Content` warns in dev when it has no `DialogTitle`; confirm `Command.Dialog`'s
  `label` prop satisfies it (or add a visually-hidden title) so Task 5's console check is quiet.

**Filtering strategy: `shouldFilter={false}` on `<Command>`; we filter ourselves.** Nav items:
case-insensitive `includes` of the trimmed query against `label`, `group`, and `href` (three
lines). People items: already server-filtered, rendered as-is. Why not cmdk's built-in fuzzy
filter: it would have to be bypassed for the people group anyway, its `Command.Empty` count would
score `person:<id>` values as non-matches and show "No results" beside a real hit, and the e2e
gating assertion ("Settings" → zero items for a mentor) should not depend on a subsequence matcher's
behaviour. With `shouldFilter={false}`, what is rendered is exactly what matched, and `Command.Empty`
shows only when nothing is rendered — deterministic, and zero cmdk internals to verify.

**Component sketch** (`src/components/CommandPalette.tsx`, `"use client"`):

```tsx
type Props = { destinations: NavDestination[]; canSearchPeople: boolean };
type PersonHit = { id: string; name: string; role: string; isActive: boolean; gradYear: number | null };

export function CommandPalette({ destinations, canSearchPeople }: Props) {
  const router = useRouter();                       // next/navigation
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [isMac, setIsMac] = useState(true);         // server renders ⌘K; corrected post-mount

  // ⌘K / Ctrl+K toggles. Same shape as SidebarKeyShortcut (window keydown in useEffect with
  // cleanup). No INPUT/TEXTAREA guard: a modified chord is unambiguous, and the palette should
  // open from anywhere — including while typing in a page field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // people search effect — see §2.3 (debounce + abort)

  function go(href: string) { setOpen(false); setQuery(""); router.push(href); }

  const q = query.trim().toLowerCase();
  const matches = (d: NavDestination) =>
    !q || d.label.toLowerCase().includes(q) || d.group.toLowerCase().includes(q) || d.href.includes(q);
  const groups = ["Overview", "Shop floor", "Team", "Admin"] as const;
  return (
    <>
      <button type="button" className="tb-search" onClick={() => setOpen(true)}
              aria-label="Search" aria-keyshortcuts="Meta+K Control+K">
        <Icon name="search" className="ic" />
        <span>Search</span>
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Command.Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}
                      label="Search and navigate" overlayClassName="palette-overlay" contentClassName="palette"
                      shouldFilter={false}>
        <Command.Input value={query} onValueChange={setQuery}
                       placeholder={canSearchPeople ? "Go to a page or find a person…" : "Go to a page…"} />
        <Command.List>
          <Command.Empty>{searching ? "Searching…" : "No results"}</Command.Empty>
          {canSearchPeople && people.length > 0 && (
            <Command.Group heading="People">
              {people.map((p) => (
                <Command.Item key={p.id} value={`person:${p.id}`} onSelect={() => go(`/people/${p.id}`)}>
                  <Icon name="users" className="ic" />
                  <span>{p.name}</span>
                  <span className="meta">{p.role}{p.gradYear ? ` · ${p.gradYear}` : ""}{p.isActive ? "" : " · inactive"}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {groups.map((g) => {
            const items = destinations.filter((d) => d.group === g && matches(d));
            return items.length ? (
              <Command.Group key={g} heading={g}>
                {items.map((d) => (
                  <Command.Item key={d.href} value={`${d.label} ${g}`} onSelect={() => go(d.href)}>
                    <span>{d.label}</span><span className="meta">{d.href}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null;
          })}
        </Command.List>
      </Command.Dialog>
    </>
  );
}
```

Notes on the sketch:
- `value` for nav items is `"<label> <group>"` so the two "People"/"Teams"/"Events" pairs have
  distinct cmdk values (cmdk keys selection identity by value; duplicates misbehave). With
  `shouldFilter={false}` the value is only an identity, never matched against the query. `matches`
  checks `href` too, so "settings" and "/admin/settings" both hit.
- Person `value` is `person:<id>` — never the name, so a person named like a page cannot collide.
- Group hue: pass `style={grp(hue)}` per group if wanted for the colored left tick (`--grp` var, see
  `SiteNav.grp`); optional polish, not required.
- The empty state with a blank query is just the nav list — always at least Home + Leaderboard, so
  `Command.Empty` never shows for a blank query.

**Open/close:** cmdk/Radix handles Escape, overlay click, focus trap, `aria-modal`,
`role="dialog"`, focus restore to the trigger, and unmounts content when closed (so no closed-state
DOM). `onOpenChange(false)` resets the query. Selecting an item calls `router.push` then closes.

**Accessibility:** Radix dialog semantics as above; `Command` renders a `role="combobox"` input
with `aria-controls`/`aria-activedescendant` listbox wiring; `label` prop gives the combobox its
accessible name. The trigger has `aria-label="Search"` and `aria-keyshortcuts`. Nothing custom.

### 2.5 Styling (`src/app/globals.css`)

Inside the existing topbar block (next to `.tb-actions`, ~line 1473):

```css
/* ⌘K palette trigger — the mockup's .tb-search slot. Right-aligned; owns the
   auto margin so .tb-actions sits beside it (two auto margins would split the space). */
.tb-search {
  margin-left: auto;
  display: flex; align-items: center; gap: 8px;
  width: 250px; height: 30px; padding: 0 8px;
  background: var(--canvas);            /* mockup's --sunken → deepest existing neutral */
  border: 1px solid var(--hair); border-radius: 7px;
  color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; text-align: left;
}
.tb-search:hover { color: var(--ink); border-color: color-mix(in srgb, var(--muted) 40%, var(--hair)); }
.tb-search .ic { width: 14px; height: 14px; flex: none; }
.tb-search kbd {
  margin-left: auto; font-family: var(--font-mono); font-size: 10px;
  background: var(--surface); border: 1px solid var(--hair); border-radius: 4px;
  padding: 0 5px; color: var(--muted);
}
.tb-actions { display: flex; align-items: center; gap: 10px; }   /* margin-left:auto REMOVED */
```

Palette (new block near `.modal-backdrop`, same z-index layer = 100):

```css
.palette-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.5); }
.palette {
  position: fixed; z-index: 101; top: 14vh; left: 50%; transform: translateX(-50%);
  width: min(560px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--hair); border-radius: 12px;
  box-shadow: 0 12px 40px -12px rgba(0, 0, 0, 0.5); overflow: hidden;
}
.palette [cmdk-input] {
  width: 100%; padding: 14px 16px; font: inherit; font-size: 14px; color: var(--ink);
  background: transparent; border: 0; border-bottom: 1px solid var(--hair); outline: none;
}
.palette [cmdk-list] { overflow-y: auto; padding: 6px; }
.palette [cmdk-group-heading] {
  padding: 8px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted);
}
.palette [cmdk-item] {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 7px;
  font-size: 13.5px; color: var(--ink); cursor: pointer;
}
.palette [cmdk-item][data-selected="true"] { background: var(--surface-2); }
.palette [cmdk-item] .meta { margin-left: auto; font-size: 12px; color: var(--muted); }
.palette [cmdk-item] .ic { width: 15px; height: 15px; flex: none; color: var(--muted); }
.palette [cmdk-empty] { padding: 18px; text-align: center; font-size: 13px; color: var(--muted); }
```

All colors are tokens, so light/dark follow `:root` / `[data-theme]` automatically; no per-theme
rules needed. Add `.palette-overlay, .palette` to nothing in `@media print` — Radix unmounts them
when closed, and nobody prints with the palette open.

## 3. Alternatives considered

- **Full data-driven `SiteNav`** (render groups/flyouts/rail/tabbar from `NAV_ITEMS`). Rejected:
  large diff to a shipped, e2e-guarded nav for no user-visible gain. Swapping booleans for `can()`
  lookups gives the same single-source guarantee at a fraction of the risk.
- **Keep `ADMIN_ITEMS` in `SiteNav` and hand-list primary links in the palette.** Rejected: that is
  exactly the duplicated gating the brief forbids; the two would drift.
- **Mount the palette in `layout.tsx` + trigger in `SiteTopbar` talking via a custom event/store.**
  Rejected: two seams and cross-component plumbing to avoid one prop pass.
- **Client-side people search over the full roster** (as `/people` does). Rejected: would ship
  every mentor the whole roster on every page load just to have the palette ready. A tiny GET is
  cheaper and keeps the PII projection on the server.
- **New `searchPeople` lib function.** Rejected: `listPeople(q)` already is the search; slicing and
  projecting in the route is a few lines. Add a lib function when a second caller appears.
- **Ctrl+K only / "/" shortcut / mobile search tab.** Deferred (§7).

## 4. Trade-offs & risks

- **cmdk API drift.** Spec written without the package on disk; the coder validates every prop
  and attribute against the installed types. Filtering is done in-component precisely so nothing
  depends on cmdk's matcher or `Empty`-counting internals.
- **React 19.2 / Next 16.3 peer compatibility** of cmdk + bundled Radix Dialog. Install task fails
  loudly; if incompatible, stop and report — do not force-install.
- **Ctrl+K collides with browser shortcuts** (address-bar search in Chrome/Firefox). `preventDefault`
  wins only when the page has focus, which is the normal case; when it does not, the browser wins.
  Acceptable and standard for ⌘K palettes.
- **Two `getViewer()` calls per request** (`SiteNav` + `SiteTopbar`) — pre-existing; the palette
  adds one `verifyKioskToken` that short-circuits without a kiosk cookie.
- **Hydration:** the trigger renders `⌘K` on the server and swaps to `Ctrl K` post-mount via state,
  so there is no mismatch. Never read `navigator` during render.
- **Empty-state flash:** with a non-matching nav query, `Command.Empty` shows "No results" for the
  150ms debounce, then "Searching…" during the round-trip, before people results land. Cosmetic;
  accepted (set `searching=true` at keystroke instead of at timer-fire if it bothers anyone).
- **Portal dependency:** the trigger sits inside `.topbar` (`display:none` <768px). The keydown
  listener still runs in a hidden ancestor, and the dialog escapes it *only because* it is portaled
  to `<body>`. If cmdk's Dialog does not portal, wrap it in a Radix `Portal` (cmdk depends on
  `@radix-ui/react-dialog`, which exports one) or the palette is invisible on mobile keyboards.
- **RSC payload = the security seam.** The filtered `destinations` array lands in the page's RSC
  payload. Filtering happens in `navDestinations()` on the server; nothing on the client widens it.

## 5. Implementation outline / task breakdown

Ordered; each task is a separate, reviewable commit (push after each). Verification gates:
`./dev npm run lint`, `./dev npm run typecheck`, `./dev npm run test`, and the named e2e specs
(`./dev npx playwright test e2e/<spec>`; full e2e exceeds the 10-minute tool cap — run targeted
specs, then the full suite once at the end in the background).

1. **Install cmdk** — `mechanic`. `./dev npm install cmdk` (container, not host). Commit
   `package.json` + `package-lock.json`. Abort and report if npm prints peer-dependency warnings
   involving react/react-dom — do not use `--legacy-peer-deps`/`--force`. Then read
   `node_modules/cmdk/dist/index.d.ts` and paste the `Command.Dialog`, `Command.Item`,
   `Command.Group` prop types plus the list of `cmdk-*` data attributes into the task report for
   Task 5.

2. **`src/lib/nav-destinations.ts` + `nav-destinations.test.ts`** — `coder`. Module per §2.2
   (move `ADMIN_ITEMS` verbatim, with its section comments, into `NAV_ITEMS`). Tests: the truth
   table in §2.2 (guest / kiosk-guest / student / mentor / admin); mentor list excludes the same
   `ADMIN_ONLY_HREFS` array `e2e/auth-gating.spec.ts` uses (copy the array, cite the spec);
   `href` uniqueness across `NAV_ITEMS`; `isAllowed` for `"kiosk"` gate with `kioskRegistered`
   true/false at guest and mentor.

3. **Refactor `SiteNav.tsx` to consume the module** — `coder`. Per §2.2: delete local
   `ADMIN_ITEMS`, compute `dest`/`can`, swap every link guard to `can(href)`, derive
   `adminItems`/`peopleItems`/`eventsItems`/`showShopFloor`/`showTeam`/`shopPrimary`/`teamPrimary`
   from `dest`. No JSX structure changes. `isStudent`/`isMentor`/`isAdmin` locals removed (or
   justified). Verify: `./dev npx playwright test e2e/auth-gating.spec.ts e2e/smoke.spec.ts
   e2e/mentor.spec.ts e2e/sticky-chrome.spec.ts` green, plus lint/typecheck/test.

4. **`GET /api/people/search`** — `coder`. Route per §2.3 with the literal
   `export const GET = withRole("mentor", …)` (the route-auth allowlist test depends on that
   shape). `route.test.ts` following `src/app/api/realtime-token/route.test.ts`: `vi.mock("@/lib/viewer")`
   + `vi.mock("@/lib/people")`, call `GET(new Request("http://x/api/people/search?q=…"))`.
   Cases: student → 403 with no `listPeople` call; mentor blank/whitespace `q` → `{people: []}`
   with no `listPeople` call; mentor `q="te"` → exact key set `{id,name,role,isActive,gradYear}`
   (assert `Object.keys` sorted — no email/phone), inactive sorted after active, capped at 8, `q`
   truncated to 80 chars before reaching `listPeople`. Confirm `route-auth-allowlist.test.ts`
   still passes untouched.

5. **`CommandPalette.tsx` + mount in `SiteTopbar.tsx` + CSS** — `coder`. Component per §2.4
   (validate cmdk props against Task 1's report; `shouldFilter={false}` + in-component `matches`).
   `SiteTopbar`: add `cookies`/`KIOSK_COOKIE`/`verifyKioskToken`/
   `navDestinations`/`hasRole` imports, `Promise.all`, mount before `.tb-actions`, and update the
   header comment ("Home to notifications and search later" → search lives here now). CSS per
   §2.5 including removing `margin-left:auto` from `.tb-actions`. Manual check at
   `http://localhost:$APP_PORT` as admin, mentor, student, guest in light and dark: trigger
   alignment, ⌘K/Ctrl+K toggles, Escape/overlay close, arrow keys + Enter navigate, people group
   appears for mentor+ only, inactive tag, "Ctrl K" hint on non-Mac.

6. **`e2e/command-palette.spec.ts`** — `coder`. Session via `e2e/helpers/session.ts` cookies.
   Desktop viewport (default). Tests:
   - mentor: `goto("/")`, `page.keyboard.press("ControlOrMeta+k")`, `getByRole("dialog")` visible;
     type `Tools`, `Enter`, `page.waitForURL("**/tools")` (cold `next dev` compile — use
     `waitForURL`, not a tight `expect`).
   - mentor: click `.tb-search` opens the dialog; type `Test Adm`; option `Test Admin` visible under
     the People heading; click it → `waitForURL("**/people/00000000-0000-0000-0000-00000000000a")`.
   - mentor: type `Settings` → `[cmdk-item]` count 0 / "No results" text (palette-level admin
     gating; the existing `a[href]` assertions cannot see cmdk `<div>` items).
   - student (`studentSessionCookie`): open palette, type `Test Mentor` → no "People" heading;
     `page.request.get("/api/people/search?q=Test")` → 403.
   - guest (no cookie): `page.request.get("/api/people/search?q=Test")` → 403. `withRole`
     (`src/lib/api.ts`) returns `{ error: "forbidden" }` 403 for guest and student alike — there is
     no 401 branch — so both assertions are the same literal. Mirrors `e2e/authz.spec.ts` style.

7. **Docs + graph** — `mechanic`. `docs/features.md`: add under a fitting section (new "Navigation"
   heading before "Auth & sign-in" or inside an existing UI section) —
   `- **Command palette** — ⌘K / Ctrl+K jumps to any page the viewer can see and (mentor+) finds
   people by name. Top bar → Search`. Then `graphify update .` and commit `graphify-out/`.

8. **Final gates + PR** — `coder`. Full `lint`/`typecheck`/`test`; full e2e in the background
   (exceeds the 10-minute tool cap; poll); rebase onto `origin/master`; `gh pr create` referencing
   #227.

## 6. Testing summary

- **Unit (vitest, `src/**/*.test.ts` only):** `nav-destinations.test.ts` (role truth table,
  `ADMIN_ONLY_HREFS` parity with e2e, href uniqueness); `api/people/search/route.test.ts` (403,
  blank-q short-circuit, exact response keys, ordering, cap, length bound).
  `route-auth-allowlist.test.ts` passes untouched because the route uses the standard shape.
- **E2E (Playwright, cookie sign-in):** `e2e/command-palette.spec.ts` per Task 6; existing
  `auth-gating`, `smoke`, `mentor`, `sticky-chrome` guard the `SiteNav` refactor.
- **Manual (Task 5):** light/dark, four roles, keyboard-only pass.

## 7. Open risks / edge cases

- **Mobile:** trigger is desktop-only (it lives in the hidden `.topbar`); ⌘K/Ctrl+K still opens the
  portaled dialog on tablets with keyboards. No touch entry point in this PR — the tab bar + More
  sheet already cover mobile nav. Follow-up if wanted: a "Search" row in the More sheet calling the
  same `setOpen(true)` (needs the trigger↔dialog wiring this design deliberately avoided).
- **Guest / kiosk guest / no `person`:** nav-only palette (Home, Leaderboard, +Kiosk when
  registered); placeholder says "Go to a page…"; no people fetch is ever issued.
- **Student:** nav-only; `canSearchPeople=false`; API returns 403 if hit directly.
- **Masquerade:** role is the target's, so people search follows the target's permissions.
- **Empty states:** blank query → grouped nav list (never empty); no nav match + no people →
  "No results"; during the debounce/round-trip → "Searching…".
- **Duplicate labels** (People/Teams/Events in Team vs Admin groups): disambiguated by group
  heading and the `href` meta; cmdk values are `"<label> <group>"`, so selection is unambiguous.
- **`/onshape` panel routes:** `AppShell` omits the topbar there, so no palette and no listener —
  intended (embedded iframe).
- **`listPeople` swallows select errors** (pre-existing; out of scope). A DB error renders as
  "No results" rather than an error toast. Acceptable for a jump-to; fix at the lib when its
  callers are audited.

# Parts domain + shop dashboard (issues #8–#11)

Port of the cheesy-parts (Team254/cheesy-parts) parts-tracking domain into the hub:
structured part numbering (#8), assembly hierarchy (#9), the 20-status manufacturing
pipeline (#10), and the public kanban shop dashboard (#11). Source survey:
`docs/research/sources/cheesy-parts.md`. Scope decisions: `docs/research/01-feature-catalog.md` §3.1–3.4.

## Problem & constraints

The hub has no parts domain. We are porting cheesy-parts' project/part model wholesale,
minus its cruft, so the shop dashboard (#11) has something to display.

Locked product decisions (do not revisit during implementation):

1. **Grouping is a standalone `project` table** (name + unique `part_number_prefix`).
   Deliberately NOT linked to `period` — one robot ≈ one project, exactly like cheesy-parts.
2. **The dashboard is public / kiosk-style.** A shop-floor TV can't OAuth, so *viewing*
   `/shop` and its data endpoint must work for guests (no login). All create/edit/delete
   stays behind mentor+ auth.
3. **Faithful port, YAGNI-trimmed.** Dropped from cheesy-parts: WordPress SSO, all
   email/notifications, `hide_unused_fields`/simplified-mode config, per-project
   `hide_dashboards`, and the whole purchasing/orders subsystem (§3.5–3.6, "later").
   Kept: numbering algorithm, assembly tree, 20-status pipeline, priority,
   manufacturing detail fields, child-delete guards.

Repo constraints this design obeys:

- Migrations in `supabase/migrations/`, house style per `20260817182818_events.sql`:
  `uuid primary key default gen_random_uuid()`, RLS enabled with **zero policies**
  (service-role-only), why-comments in the DDL. No GRANT statements — default
  privileges from `20260811101553_service_role_grants.sql` cover new tables.
- Data access in `src/lib/parts.ts` + colocated `parts.test.ts` (Vitest, TDD): pure
  `parseXInput(body): Input | null` validators built on `src/lib/validate.ts`; async
  mutators returning `{ok, status, ...}`; error mapping 23503→400, 23505→409
  (see `src/lib/events.ts`).
- Mutation routes wrapped in `withRole("mentor", ...)` from `src/lib/api.ts`
  (which also blocks writes while masquerading). Public reads follow
  `src/app/api/whos-here/route.ts`: `await getViewer()` only, no role check.
- No middleware gates pages; each page self-gates (admin pages
  `redirect("/")` for < mentor; public pages just render).
- Everything runs in Docker via `./dev`; schema applies via `./dev npm run db:reset`.

## 1. Data model

One migration: `supabase/migrations/<YYYYMMDDHHMMSS>_parts.sql` (timestamp at
implementation time).

```sql
-- Parts domain (issues #8–#11), ported from Team254/cheesy-parts.
-- Projects group parts; parts form a tree (assemblies contain parts and
-- sub-assemblies) and carry a 20-stage manufacturing status. The public
-- shop dashboard (/shop) reads these tables; all writes are mentor+.

create table project (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Prefix of every rendered part number (e.g. "RA2026" -> RA2026-A-0100).
  -- Renaming it retroactively renames all the project's parts — numbers are
  -- derived at render time, never stored formatted (matches cheesy-parts).
  part_number_prefix text not null unique,
  created_at timestamptz not null default now()
);

alter table project enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

create table part (
  id uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: deleting a project with parts must 409 (cheesy
  -- orphaned them; we guard). deleteProject() checks first for a clean 409,
  -- the FK is the backstop — same pattern as session.event_id / deleteEvent().
  project_id uuid not null references project (id) on delete restrict,
  -- Self-FK tree. NULL = top-level (cheesy-parts used a 0 sentinel — any data
  -- import must translate 0 -> NULL). restrict = "can't delete assembly with
  -- children"; deletePart() checks first and returns 409.
  parent_part_id uuid references part (id) on delete restrict,
  part_number integer not null,
  type text not null check (type in ('part', 'assembly')),
  name text not null,
  status text not null default 'designing' check (status in (
    'designing', 'material', 'ordered', 'drawing', 'ready',
    'cnc', 'laser', 'lathe', 'mill', 'printer', 'router',
    'manufacturing', 'outsourced', 'welding', 'scotchbrite',
    'anodize', 'powder', 'coating', 'assembly', 'done')),
  priority integer not null default 1 check (priority in (0, 1, 2)),
  notes text,
  source_material text,
  have_material boolean not null default false,
  quantity text,      -- free text in cheesy-parts ("4", "2 + spares"); kept as text
  cut_length text,    -- free text in cheesy-parts; kept as text
  drawing_created boolean not null default false,
  created_at timestamptz not null default now(),
  -- Numbers are unique per project across BOTH types (cheesy migration 009).
  -- Also the backstop for the non-transactional number-allocation race —
  -- createPart() retries once on 23505. Doubles as the (project_id, ...)
  -- index for the dashboard/list "all parts of project X" queries.
  constraint part_number_unique_per_project unique (project_id, part_number)
);

-- Children lookups: delete guard ("does this assembly have children?") and
-- the sibling-max query in number allocation.
create index part_parent_idx on part (parent_part_id);

alter table part enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
```

Deliberate omissions (do not add):

- No `updated_at`/`created_by` on `part` — cheesy-parts has neither; nothing reads them.
- No DB check that a parent is an assembly in the same project — enforced in
  `createPart()` (400), like cheesy enforced it in routes. A composite-FK trick isn't
  worth it for a mentor-only write path.
- No re-parenting: `parent_part_id` is set at insert and never updated (faithful to
  cheesy — its edit form has no parent field). This is also what makes tree cycles
  impossible without any cycle check.
- No format constraint on `part_number_prefix` in the DB; format is enforced by the
  input parser (below), one trust boundary is enough.

## 2. Numbering algorithm (port of `Part.generate_number_and_create`)

Lives in `createPart()` in `src/lib/parts.ts`. Exact semantics:

- **Assembly:** next number = (max `part_number` among the project's rows with
  `type = 'assembly'`, or **-100** if none) **+ 100**. First assembly of a project
  is therefore **0**, then 100, 200, …
- **Part:** next number = (max `part_number` among rows with the same `project_id`,
  the same parent, and `type = 'part'`, or — if no such sibling — the **parent's own
  `part_number`**, or **0** when creating top-level with no parent) **+ 1**.
  So assembly 100 owns parts 101, 102, …; top-level parts are 1, 2, …

Supabase-js has no `max()`; use order-desc-limit-1:

```ts
// assembly branch
const { data } = await client.from("part").select("part_number")
  .eq("project_id", projectId).eq("type", "assembly")
  .order("part_number", { ascending: false }).limit(1).maybeSingle();
const next = (data?.part_number ?? -100) + 100;

// part branch — NULL parent needs .is(), not .eq() (the 0-sentinel translation
// point: cheesy filtered parent_part_id = 0, we filter IS NULL)
let q = client.from("part").select("part_number")
  .eq("project_id", projectId).eq("type", "part");
q = parentPartId ? q.eq("parent_part_id", parentPartId) : q.is("parent_part_id", null);
// seed = sibling max ?? (parent?.part_number ?? 0); next = seed + 1
```

**Race:** compute-then-insert is not transactional (neither was cheesy's). Two
concurrent creates can pick the same number; the
`part_number_unique_per_project` constraint rejects the loser (23505).
`createPart()` recomputes and retries **once** on 23505; a second 23505 returns
`{ok: false, status: 409}`. Do not build advisory locks or a DB function —
mentor-only writes on a small team don't justify it.

**Rendered ("full") part number** is derived at render time, never stored:

```ts
/** e.g. fullPartNumber("RA2026", "assembly", 100) === "RA2026-A-0100" */
export function fullPartNumber(prefix: string, type: PartType, n: number): string {
  return `${prefix}-${type === "assembly" ? "A" : "P"}-${String(n).padStart(4, "0")}`;
}
```

Pure function in `src/lib/types.ts` next to the maps. Editing a project's prefix
silently renames every part — intended behavior, matches cheesy.

Known ceiling (accepted, faithful to cheesy): >99 parts under one assembly walks
into the next assembly's number block; the unique constraint then rejects creates
with 409. Fine for a robot; not worth fixing.

## 3. Status + priority maps

All in `src/lib/types.ts` (alongside `Role`, `SessionSource`, etc.).

```ts
export type PartType = "part" | "assembly";
export type PartPriority = 0 | 1 | 2;

export const PART_STATUSES = [
  "designing", "material", "ordered", "drawing", "ready",
  "cnc", "laser", "lathe", "mill", "printer", "router",
  "manufacturing", "outsourced", "welding", "scotchbrite",
  "anodize", "powder", "coating", "assembly", "done",
] as const;
export type PartStatus = (typeof PART_STATUSES)[number];
```

`PART_STATUSES` order **is** the pipeline order — dropdowns and the dashboard's
row order both iterate it. Labels are verbatim from cheesy-parts `models/part.rb`
`STATUS_MAP` (verified at commit `034ef59`):

| key | label | tone |
|---|---|---|
| `designing` | Design in progress | `design` |
| `material` | Material needs to be ordered | `blocked` |
| `ordered` | Waiting for materials | `blocked` |
| `drawing` | Needs drawing | `design` |
| `ready` | Ready to manufacture | `ready` |
| `cnc` | Ready for CNC | `ready` |
| `laser` | Ready for laser | `ready` |
| `lathe` | Ready for lathe | `ready` |
| `mill` | Ready for mill | `ready` |
| `printer` | Ready for 3D printer | `ready` |
| `router` | Ready for router | `ready` |
| `manufacturing` | Manufacturing in progress | `working` |
| `outsourced` | Waiting for outsourced manufacturing | `working` |
| `welding` | Waiting for welding | `working` |
| `scotchbrite` | Waiting for Scotch-Brite | `working` |
| `anodize` | Ready for anodize | `working` |
| `powder` | Ready for powder coating | `working` |
| `coating` | Waiting for coating | `working` |
| `assembly` | Waiting for assembly | `working` |
| `done` | Done | `done` |

```ts
export const STATUS_MAP: Record<PartStatus, string> = { /* labels above */ };
export type StatusTone = "design" | "blocked" | "ready" | "working" | "done";
export const STATUS_TONE: Record<PartStatus, StatusTone> = { /* tones above */ };
export const PRIORITY_MAP: Record<PartPriority, string> = { 0: "High", 1: "Normal", 2: "Low" };
```

**Colors are NOT ported from cheesy's Bootstrap-2 hexes** (deliberate). The five
tones map to badge styles defined once in `src/app/globals.css` (classes
`status-design` / `status-blocked` / `status-ready` / `status-working` /
`status-done`): design = blue, blocked = amber/yellow, ready = green,
working = orange, done = gray/muted — light + dark variants using the app's
existing CSS-variable approach. Priority styling on dashboard tiles:
0 High = red left-border/tint (`var(--red)`), 1 Normal = default card,
2 Low = muted/faded. Exact shades are the coder's call; the *grouping above is not*.

## 4. Surfaces

Route-path choices: public board under **`/shop`** (short, guest-facing, reads well
on a TV bookmark); CRUD under **`/admin/projects`** (projects are the aggregate
root and the admin index groups by noun-cards); part detail flat at
**`/admin/parts/[id]`** (part ids are globally-unique uuids — nesting under
`/admin/projects/[projectId]/parts/[id]` buys nothing and doubles the params).

### Pages

| Path | Auth | Behavior |
|---|---|---|
| `/shop` | public | Dashboard index: list all projects as links to their board. Server component; renders for guests (no redirect). |
| `/shop/[projectId]` | public | The kanban board. Server component shell (project name, back link) + `<ShopBoard>` client component (see below). 404 via `notFound()` for unknown id. |
| `/admin/projects` | mentor+ | Project list (name, prefix, part count) + collapsed "New project" form (`details`/`summary`, like `/admin/events`). Rows link to `/admin/projects/[id]`; also link each row to its `/shop/[id]` board. |
| `/admin/projects/[id]` | mentor+ | Project detail: header with Edit (`?edit=1` swaps in the form, events-page pattern) and Delete (guard below); sortable parts table; collapsed "New part" form. |
| `/admin/parts/[id]` | mentor+ | Part detail: breadcrumb ancestor chain (project › assembly › … › part), attribute table (full number, type, name, status, notes; for `type='part'` also source material, have material, quantity, cut length, drawing created, priority), Edit (`?edit=1`), Delete. If the part is an assembly, list its children (same table component as the project page). |

Parts table (project page + assembly children): columns Number (rendered
`fullPartNumber`, `mono` class, links to `/admin/parts/[id]`), Type, Name, Parent
(link), Status (inline-editable, below), Priority. Sorting via `?sort=`
`number|type|name|parent|status` (default `number`), computed in-memory in the
server component — a project holds hundreds of rows at most, no DB ordering
gymnastics. Sort is ascending only (cheesy had no direction toggle either).

**Inline status change** (`<PartStatusCell>` client component): the status badge
is a `<select>` styled as a badge (or badge that swaps to a select on click —
coder's call); on change it `PATCH`es `{status}` to `/api/admin/parts/[id]` and
updates in place via `router.refresh()`. This replaces cheesy's jQuery
`editPart` AJAX.

**`<ShopBoard>`** client component (the whole of issue #11):

- Fetches `GET /api/shop/[projectId]` on mount and every **10 s** (`setInterval`;
  no visibility pause, no websockets — it's a TV).
- Groups parts by status in `PART_STATUSES` order: one row/column per status,
  **skipping empty statuses**, **hiding `done` entirely** unless it's the selected
  filter. Within a status, order by `priority` asc (High first), then `part_number`.
- Tiles show `fullPartNumber` + name, colored by priority (tone table above),
  `title` attribute = name (hover tooltip). **Tiles do not link anywhere** — part
  detail is mentor-only, and a guest board must not render dead links (same
  principle as the leaderboard's `canLink`).
- **Status filter**: a `<select>` of all 20 statuses + "All". The choice is written
  to the URL (`?status=cnc`) with `router.replace`, and read on load — so it
  survives both the 10 s refresh *and* a full page reload / TV power cycle
  (deliberate improvement over cheesy's in-memory JS variable).

### API routes

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/shop/[projectId]` | GET | public (`await getViewer()` only, whos-here pattern) | `{ project: { id, name }, parts: [{ id, fullPartNumber, type, name, status, priority }] }`. One flat array per refresh; grouping happens client-side. (Replaces cheesy's 20-queries-per-refresh partial.) `fullPartNumber` is computed server-side so the prefix never ships separately. 404 for unknown project. No notes/material fields — the public payload carries only what tiles render. |
| `/api/admin/projects` | POST | mentor | `parseProjectInput` → 400; `createProject` → 201 `{id}`; duplicate name/prefix → 409. |
| `/api/admin/projects/[id]` | PUT | mentor | Full-input update (name + prefix). 400/404/409 per lib result. |
| `/api/admin/projects/[id]` | DELETE | mentor | Refuses when the project has any parts: explicit check → 409 (FK restrict is the backstop). 404 unknown. |
| `/api/admin/parts` | POST | mentor | `parsePartInput` → 400; validates parent (exists, same project, `type='assembly'`) → 400; allocates number (retry-once) → 201 `{id, partNumber}` or 409. |
| `/api/admin/parts/[id]` | PATCH | mentor | Partial update via `parsePartPatch` (below). Serves both the full edit form and the one-field inline status change. 400 invalid, 404 unknown. |
| `/api/admin/parts/[id]` | DELETE | mentor | Refuses when the part has children: explicit check → 409 ("Can't delete assembly with existing children" semantics). 404 unknown. |

**Why PATCH, not the repo's usual full-input PUT** (one deliberate deviation):
the inline status change fires from a list row that doesn't have the full record;
round-tripping every field to change one is exactly the fragility cheesy's
`redirect=false` hack papered over. One PATCH endpoint with
partial semantics serves both callers. `parsePartPatch(body)` returns the subset
of provided fields, `null` if the body is empty/no known field present *or any
provided field is invalid*. Immutable via PATCH: `project_id`, `parent_part_id`,
`part_number`, `type`.

### Validators (all in `src/lib/parts.ts`, pure, null = invalid)

- `parseProjectInput`: `name` reqString 80; `partNumberPrefix` must match
  `/^[A-Za-z0-9]{1,20}$/` then uppercased (it becomes a CAD-filename prefix —
  hyphens would break the `PREFIX-A-0100` shape; cheesy allowed anything, we don't).
- `parsePartInput` (create): `projectId` reqUuid; `type` ∈ `part`|`assembly`;
  `name` reqString 120; `parentPartId` optional uuid (absent/null = top-level).
  Creation sets nothing else — details are added via edit, like cheesy.
- `parsePartPatch`: optional fields — `name` reqString 120; `status` ∈
  `PART_STATUSES`; `priority` ∈ {0,1,2}; `notes` optString 2000;
  `sourceMaterial` optString 200; `quantity` optString 50; `cutLength` optString 50;
  `haveMaterial`/`drawingCreated` boolean.

### Data-access functions (`src/lib/parts.ts`, events.ts shapes)

`createProject`, `listProjects`, `getProject`, `updateProject`,
`deleteProject` (check-parts-then-409), `createPart` (numbering + retry),
`listParts(projectId)` (one query, all rows), `getPart`, `updatePart(id, patch)`,
`deletePart` (check-children-then-409). Plus pure helpers `partAncestors(part, all)`
(breadcrumb chain built from an in-memory `listParts` result — no recursive SQL)
and `sortParts(parts, key)`. All mutators take the optional `db?: SupabaseClient`
param for test injection and map 23503→400 / 23505→409 like `events.ts`.

Types in `src/lib/types.ts`: `ProjectRow`/`Project`/`projectFromRow`,
`PartRow`/`Part`/`partFromRow` (snake→camel, exactly the existing mapper pattern).

## 5. File map

**Migration**
- `supabase/migrations/<ts>_parts.sql` — new (§1).

**src/lib**
- `src/lib/types.ts` — modify: add `PartType`, `PartStatus`, `PART_STATUSES`,
  `STATUS_MAP`, `STATUS_TONE`, `PRIORITY_MAP`, `fullPartNumber`,
  `ProjectRow`/`Project`/`projectFromRow`, `PartRow`/`Part`/`partFromRow`.
- `src/lib/parts.ts` — new: validators + data access (§4).
- `src/lib/parts.test.ts` — new: unit tests (validators; numbering incl. first
  assembly = 0, sibling seeding, NULL-parent branch, 23505 retry; delete guards;
  `fullPartNumber` padding; `partAncestors`; `sortParts`).

**src/app/api**
- `src/app/api/shop/[projectId]/route.ts` — new (public GET).
- `src/app/api/admin/projects/route.ts` — new (POST).
- `src/app/api/admin/projects/[id]/route.ts` — new (PUT, DELETE).
- `src/app/api/admin/parts/route.ts` — new (POST).
- `src/app/api/admin/parts/[id]/route.ts` — new (PATCH, DELETE).

**src/app pages**
- `src/app/shop/page.tsx` — new (public index).
- `src/app/shop/[projectId]/page.tsx` — new (public board shell).
- `src/app/admin/projects/page.tsx` — new (list + create).
- `src/app/admin/projects/[id]/page.tsx` — new (detail, parts table, new-part form).
- `src/app/admin/parts/[id]/page.tsx` — new (part detail/edit/delete).

**src/components**
- `ShopBoard.tsx` — new (client: polling, grouping, filter).
- `ProjectForm.tsx` — new (create/edit project; EventForm pattern).
- `PartForm.tsx` — new (create part: name/type/parent-assembly dropdown).
- `PartEditForm.tsx` — new (full edit → PATCH). May be merged with PartForm if
  it stays small — coder's call.
- `PartStatusCell.tsx` — new (inline status select → PATCH).
- `PartsTable.tsx` — new (shared by project page + assembly children list).
- `DeleteProjectButton.tsx` / `DeletePartButton.tsx` — new (confirm + DELETE +
  redirect; clone the existing `DeleteTeamButton` shape).

**Wiring**
- `src/components/SiteNav.tsx` — modify: add public `Shop` link (`/shop`,
  unguarded, next to Leaderboard).
- `src/app/admin/page.tsx` — modify: add a `Card` for `/admin/projects`
  (icon "chevron" or similar, title "Parts", count = project count via
  `listProjects()`, hint "Part numbering, assemblies, shop dashboard.") in a new
  "Shop" section or the existing grid — placed for mentors (not admin-only).
- `src/app/globals.css` — modify: five `status-*` badge tone classes + priority
  tile classes (§3).

**E2E**
- `e2e/shop.spec.ts` — new (see §7; follow existing self-seeding e2e conventions).

## 6. Task breakdown (subagent execution order)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 1 | **Migration + types**: write `<ts>_parts.sql` exactly per §1; add all §3 maps/types + `fullPartNumber` + Row/domain types/mappers to `types.ts`; `./dev npm run db:reset` to verify it replays. | coder | — |
| 2 | **Parts lib + tests** (TDD): `src/lib/parts.ts` + `parts.test.ts` — validators, CRUD, numbering with retry, delete guards, `partAncestors`, `sortParts`. | coder | 1 |
| 3 | **API routes**: the six route files in §4/§5. Thin wrappers over the lib; mentor routes via `withRole`, shop route via bare `getViewer`. | coder | 2 |
| 4 | **Admin projects CRUD pages**: `/admin/projects`, `/admin/projects/[id]` (incl. sortable `PartsTable`, `ProjectForm`, `PartForm`, `PartStatusCell`, delete buttons). | coder | 3 |
| 5 | **Admin part detail page**: `/admin/parts/[id]` (breadcrumb, attribute table, `PartEditForm`, children list, delete). | coder | 3 (parallel with 4) |
| 6 | **Public dashboard**: `/shop`, `/shop/[projectId]`, `ShopBoard` (polling, grouping, URL-param filter), `globals.css` tone classes. | coder | 3 (parallel with 4, 5) |
| 7 | **Nav + admin-index wiring**: SiteNav `Shop` link; admin `Card` for `/admin/projects`, exactly as specified in §5. | mechanic | 4 |
| 8 | **E2E + full verification**: `e2e/shop.spec.ts` per §7; run all four gates; manual browser check. | coder | 4, 5, 6, 7 |

Each task commits at its own checkpoint and pushes (repo git workflow).

## 7. Verification plan

Gates (in-container, all must pass before the PR):

    ./dev npm run db:reset     # migration replays clean on a fresh DB
    ./dev npm run lint
    ./dev npm run typecheck
    ./dev npm run test         # includes new parts.test.ts
    ./dev npm run e2e          # stack running; hits localhost:3000 in-container

E2E (`e2e/shop.spec.ts`, self-seeding like the existing suites, using dev-login
buttons for the mentor role):

1. As mentor: create a project, an assembly, a part under the assembly →
   assert numbers render as `PREFIX-A-0000` and `PREFIX-P-0001`
   (first assembly = 0, its first child = 1). Change the child's status to `cnc`
   via the inline cell.
2. **As guest (no login)**: load `/shop/<projectId>` → the board renders, the
   `cnc` group shows the part tile, empty statuses are absent, no `done` group,
   tiles contain no links.
3. Select the `cnc` filter → URL carries `?status=cnc`; **reload the page** →
   filter still applied (persistence proof).
4. Auto-refresh: with the board open, PATCH the part to `done` via API (as
   mentor context) → within ~12 s the tile disappears from the board without a
   reload (proves the 10 s poll).
5. Guards: DELETE the assembly → 409; DELETE the project → 409; delete child
   then assembly then project → all succeed.

Manual check (UI change → browser at `http://localhost:$APP_PORT`): open `/shop`
logged out, confirm tone colors read on the dark theme, and eyeball the admin
tables.

## Alternatives considered

- **Link projects to `period`** — rejected: locked decision; a robot project can
  span periods and cheesy's standalone model is simpler.
- **Kanban columns via drag-and-drop** — rejected: cheesy's board is read-only
  rows-per-status; the write path is the inline status select. No DnD dependency.
- **Realtime (Supabase channels) instead of polling** — rejected: 10 s polling of
  one public GET is one `setInterval` line and matches cheesy; realtime adds a
  client subscription + auth surface for zero perceived benefit on a TV.
- **Store the formatted part number** — rejected: derive at render time; storing
  it makes prefix renames a migration instead of a non-event.
- **`smallint`/enum types for status** — rejected: `text + check` matches the
  repo's `session_source_check` pattern and keeps the check editable by
  `NOT VALID`-style follow-up migrations.
- **Per-project dashboard hide flag, orders/purchasing, simplified mode, email** —
  dropped per locked decision #3; re-add `hide_dashboards` only if archived
  seasons ever clutter `/shop` (a one-column migration then).

## Trade-offs & risks

- **Public data exposure**: part names/numbers/statuses are world-readable by
  design (kiosk TV). The payload deliberately excludes notes and material fields;
  keep it that way if fields are added later.
- **Numbering race** is retry-once, not transactional — acceptable for mentor-only
  writes; the unique constraint guarantees no duplicates ever persist.
- **>99 parts per assembly** collides with the next assembly block (inherited
  ceiling, §2). Symptom is a 409 on create; remedy is a new assembly.
- **In-memory sorting/breadcrumbs** assume a project's parts fit in one query
  (hundreds of rows). True for a robot; revisit only if it ever isn't.
- **Prefix renames rename all CAD-facing numbers silently** — faithful to cheesy;
  mentors should know. Not guarded.
- **PATCH deviation** from the repo's PUT convention is confined to
  `/api/admin/parts/[id]` and documented here; don't let it leak into other
  domains without the same justification.

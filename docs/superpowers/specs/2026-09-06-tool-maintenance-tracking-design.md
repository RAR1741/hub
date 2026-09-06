# Tool maintenance & checks tracking v1 — design

Status: approved 2026-09-06 (roles amended) · Issue [#75](https://github.com/RAR1741/hub/issues/75)

## 1. Problem and decisions

Give the shop a record of its tools and of every inspection / maintenance / repair done on them,
so "when was the drill press last checked?" has an answer and students have a downtime task.
v1 = **inventory + append-only check log**, a straight mirror of battery tracking
(`docs/superpowers/specs/2026-09-03-battery-tracking-v1-design.md`, referenced below as *BT*),
plus a **student "request deletion" flow** reviewed in the existing mentor request queue
(`/admin/requests`), a straight mirror of excusal requests (`src/lib/excusal-requests.ts`).
Where this spec is silent, do what BT / `src/lib/batteries.ts` / `excusal-requests.ts` do.

Decisions (do not re-open):

1. **Three tables, one migration** `supabase/migrations/20260906130000_tool_maintenance.sql`:
   `tool`, `tool_check`, `tool_delete_request`. Re-run `git ls-tree origin/master
   supabase/migrations/` before naming — origin/master tops out at `20260903120000` today.
2. **Tool identity.** `name` is NOT unique (three identical drills). `asset_tag` is an optional
   unique text (nulls distinct) — the 409 path mirroring battery `number`.
3. **Lifecycle = `status in ('in_service','needs_attention','out_of_service','retired')`.**
   Retire is a PATCH of `status`, not a route. No `retired_at` / `retired_reason` / `updated_at`
   columns: nothing in v1 reads them; the check log is the history.
4. **A check can flip the tool's status** via nullable `tool_check.status_after`, applied by an
   `after insert` trigger (atomic; `createCheck` stays a single insert like `createUsage`).
   `status_after` **excludes `retired`**, and the trigger skips tools that are already
   `retired` — a check never moves a tool into *or out of* `retired`; that is a deliberate
   PATCH (§6 "Edit tool"). Deleting a mistyped check does **not** revert the status.
5. **"Due" is computed, never stored.** `nextDueAt(tool, lastCheckedAt)`: no interval → null;
   `retired` → null; never checked → `tool.created_at` (a baseline inspection is due
   immediately — intended, that is the downtime task); else `lastCheckedAt + interval days`.
6. **Roles.** Student+: view, create tool, edit any field (incl. status / retire), log a check,
   **request** deletion of a tool. Mentor+: **delete** a tool (hard delete; its checks and any
   pending request cascade), delete a check row, review deletion requests. Students never delete
   anything; check-row deletion has no request flow (YAGNI). `checked_by` / `requested_by` are
   always `viewer.person!.id`, never from the body (`withRole` gives the masquerade write-block
   for free). `tool_check` has one `person` FK; `tool_delete_request` has two → FK-hint embeds.
7. **Deletion request = the excusal-request pattern, exactly.** `status pending/approved/denied`,
   `reviewed_by`/`reviewed_at`, one *pending* request per tool via partial unique index → 409,
   reviewed at `/admin/requests` by mentor+, counted into the admin dashboard `requestsCount`.
   `reason` is **required** (≤500). Approve = mark approved, then hard-delete the tool; deny =
   mark denied (re-request allowed).
8. **`condition` is required** on every check (`good | fair | poor`, UI default `good`).
9. **`merge_person()` must learn three FKs.** Re-declare it by copying the body from
   `20260903120000_battery_tracking.sql` (the *latest* declaration) and adding, next to the
   `battery_usage` line: `tool_check.checked_by`, `tool_delete_request.requested_by`,
   `tool_delete_request.reviewed_by`. No dedupe-delete: the partial unique index is on `tool_id`
   only, so merging people cannot collide.
10. **Known gap, deferred:** status edits via PATCH leave no history row; only check-driven flips
    appear in the log.

Deferred (out of scope, open follow-up issues when v1 lands): checkout / check-in,
certification gating, reservations, QR / barcode tags, photos, replacement cost, per-tool
documentation links, category as a table, status-change audit rows for PATCHes,
notification / Slack nudges for overdue checks, request flow for check-row deletion.

## 2. Schema

```sql
create table tool (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                 -- 'Drill press', 'DeWalt 20V drill #2'
  category text,                                      -- free text: 'power tool', 'hand tool', 'machine'
  location text,                                      -- free text: 'Bench 3', 'Red cabinet'
  asset_tag text unique,                              -- optional serial / asset tag; nulls distinct
  status text not null default 'in_service'
    check (status in ('in_service', 'needs_attention', 'out_of_service', 'retired')),
  maintenance_interval_days integer check (maintenance_interval_days > 0),  -- null = no schedule
  notes text,
  created_at timestamptz not null default now()
);
alter table tool enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.
grant all on tool to service_role;

create table tool_check (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tool (id) on delete cascade,   -- mentor DELETE takes the log with it
  checked_by uuid not null references person (id) on delete restrict,  -- submitter
  checked_at timestamptz not null default now(),
  kind text not null check (kind in ('inspection', 'maintenance', 'repair')),
  condition text not null check (condition in ('good', 'fair', 'poor')),
  -- Null = no status change. Never 'retired': retire is a deliberate PATCH, not a check side effect.
  status_after text check (status_after in ('in_service', 'needs_attention', 'out_of_service')),
  notes text,
  created_at timestamptz not null default now()
);
-- Per-tool history newest first: detail page and the last-checked embed (listTools).
create index tool_check_tool_checked_idx on tool_check (tool_id, checked_at desc);
alter table tool_check enable row level security;
grant all on tool_check to service_role;

-- A check with status_after flips the tool. AFTER INSERT only: deleting a check does not revert.
-- `status <> 'retired'`: logging a check never un-retires a tool.
create function tool_check_apply_status() returns trigger language plpgsql as $$
begin
  update tool set status = new.status_after where id = new.tool_id and status <> 'retired';
  return new;
end $$;
create trigger tool_check_apply_status after insert on tool_check
  for each row when (new.status_after is not null) execute function tool_check_apply_status();

-- Student "please delete this tool" → mentor review. Mirrors excusal_request
-- (20260813005617_excusal_requests.sql). tool_id cascades: approving deletes the tool, which
-- takes the (now approved) request row with it — approved rows never survive, denied ones do.
create table tool_delete_request (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tool (id) on delete cascade,
  requested_by uuid not null references person (id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references person (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- One PENDING request per tool (re-request allowed after a denial). Also serves the
-- `status = 'pending'` queue query, so no separate status index.
create unique index one_pending_tool_delete_request_per_tool
  on tool_delete_request (tool_id) where status = 'pending';
alter table tool_delete_request enable row level security;
grant all on tool_delete_request to service_role;

-- create or replace function merge_person(...) : body from 20260903120000_battery_tracking.sql plus:
--   update tool_check set checked_by = p_winner where checked_by = p_loser;
--   update tool_delete_request set requested_by = p_winner where requested_by = p_loser;
--   update tool_delete_request set reviewed_by = p_winner where reviewed_by = p_loser;
-- grant execute on function merge_person(uuid, uuid) to service_role;
```

`src/lib/types.ts` gains `ToolStatus`, `ToolCheckKind`, `ToolCondition`, `ToolRow` / `Tool` /
`toolFromRow`, `ToolCheckRow` / `ToolCheck` / `toolCheckFromRow`, following `BatteryRow` /
`BatteryUsageRow` (~L784). `ToolCheck` carries `checkedById: string` plus `checkedBy: {
firstName, lastName, displayName }` from the `person (first_name, last_name, display_name)` embed
(same split as `BatteryUsage.techId` / `tech`). Plus `ToolDeleteRequestRow` / `ToolDeleteRequest`
/ `toolDeleteRequestFromRow` next to `ExcusalRequestRow` (~L490), reusing `ExcusalRequestStatus`
for `status` (same three values; do not add a duplicate type).

## 3. Libraries

### `src/lib/tools.ts` (new)

```ts
parseToolInput(body): ToolInput | null           // POST and PATCH share it (full replace)
parseCheckInput(body): CheckInput | null
createTool(input, db?)         → { ok: true; id } | { ok: false; status }
updateTool(id, input, db?)     → { ok: true } | { ok: false; status }     // 404 when no row
deleteTool(id, db?)            → { ok: true } | { ok: false; status }     // 404 when no row; checks cascade
listTools(db?)                 → (Tool & { lastCheckedAt: string | null })[]   // sorted, see below
getTool(id, db?)               → Tool | null
listChecks({ toolId?, limit }, db?) → ToolCheck[]   // checked_at desc, embeds person
createCheck(input, checkedBy, db?) → { ok: true; id } | { ok: false; status }
deleteCheck(id, db?)           → { ok: true } | { ok: false; status }     // 404 when no row
sortByLastChecked(rows)        // PURE: never-checked first, then oldest checked, retired last
nextDueAt(tool, lastCheckedAt) → string | null                            // PURE, §1.5
```

`mapWriteError` 23503 → 400, 23505 → 409, else 500 (copy from `batteries.ts`). `deleteTool` is
`deleteUsage` with the table swapped. `listTools` is one query: `.from("tool").select("*,
tool_check(checked_at)").order("checked_at", { referencedTable: "tool_check", ascending: false
}).limit(1, { referencedTable: "tool_check" })`, then `sortByLastChecked` (same body as
`sortByLastUsed`, tier = `status === "retired"`). `nextDueAt` lives here so the page and the
tests share it; the page derives `isDue = nextDueAt !== null && nextDueAt <= now`.

### `src/lib/tool-delete-requests.ts` (new, copy `excusal-requests.ts`)

```ts
parseToolDeleteRequestInput(body): { toolId: string; reason: string } | null   // reqUuid, reqString ≤500
createToolDeleteRequest(personId, input, db?) → { ok: true; id } | { ok: false; status }
   // 23505 → 409 (pending exists), 23503 → 400 (unknown tool). Returns id (unlike excusal) so the
   // e2e needs no db helper.
hasPendingDeleteRequest(toolId, db?)  → boolean          // detail-page pill
listPendingToolDeleteRequests(db?)    → (ToolDeleteRequest & { name: string; toolName: string })[]
   // status = pending, created_at desc; embeds `person!requested_by (id, first_name, last_name,
   // display_name)` (FK hint — two person FKs) and `tool (name)` (single FK, unqualified is fine).
reviewToolDeleteRequest(id, "approve" | "deny", reviewerId, db?) → { ok: boolean; status: number }
```

`reviewToolDeleteRequest` **inverts the excusal order — mark first, then act.** Fetch → 404 if
missing (a request whose tool is already gone was cascaded away, so this is the "tool already
deleted" case too), 409 if not pending; guarded update (`.eq("status", "pending")`) to
approved/denied, no row → 409; then, for approve only, `deleteTool(r.tool_id, client)`.
Deleting *first* would cascade the request row away and the guarded update would falsely 409.
`deleteTool` 404 after a successful mark → ok (raced). 500 → return 500: request shows approved,
tool remains, mentor uses the Delete button — same non-transactional caveat as
`approveAccountRequest`.

## 4. Validation (`parse*Input`, pure; any present-but-invalid field → null → 400)

ToolInput: `name` reqString ≤ 80; `category` optString ≤ 40; `location` optString ≤ 80;
`assetTag` optString ≤ 40; `status` one of the four `ToolStatus` values; `maintenanceIntervalDays`
optInt 1..3650; `notes` optString ≤ 2000.

CheckInput: `toolId` reqUuid; `checkedAt` optional ISO, default now (parse like `usedAt`);
`kind` one of `inspection | maintenance | repair`; `condition` one of `good | fair | poor`;
`statusAfter` undefined/null → null, else one of `in_service | needs_attention |
out_of_service` (`retired` rejected); `notes` optString ≤ 2000.

## 5. API

Battery's precedent is a *sibling* route for the log table (`/api/battery-usage`), not a nested
one, so the faithful mirror is `/api/tool-checks`; the review route sits beside the excusal one.

| Route | Role | Body → Response |
| --- | --- | --- |
| `POST /api/tools` | student | ToolInput → `201 { id }`; 400 invalid; 409 duplicate asset tag |
| `PATCH /api/tools/[id]` | student | ToolInput (full) → `200 { ok: true }`; 400; 404; 409 |
| `DELETE /api/tools/[id]` | mentor | → `200 { ok: true }`; 404. Hard delete; checks + requests cascade |
| `POST /api/tool-checks` | student | CheckInput → `201 { id }`; 400 invalid / unknown tool (23503) |
| `DELETE /api/tool-checks/[id]` | mentor | → `200 { ok: true }`; 404 |
| `POST /api/tool-delete-requests` | student | `{ toolId, reason }` → `201 { id }`; 400; 409 pending exists; 429 |
| `POST /api/admin/requests/tool-delete/[id]` | mentor | `{ action: "approve" \| "deny" }` → `200 { ok: true }`; 400; 404; 409 decided |

All via `withRole(...)`. `POST /api/tool-delete-requests` copies `api/excusal-requests/route.ts`
(`createRateLimiter({ limit: 5, windowMs: 60_000 })`, `clientIp`) but inside `withRole("student")`.
The review route is `api/admin/requests/excusal/[id]/route.ts` with the lib call swapped. No GET
routes (pages render server-side); no state-changing GET. No server-side guard against logging on
a retired tool (battery-usage has none either) — the form just omits retired tools.

## 6. Pages and components

- `src/app/tools/page.tsx` (student+, `redirect("/login")`): **Log a check** card
  (`ToolCheckForm`, non-retired tools in `sortByLastChecked` order); **Tools** table (name,
  category, location, status badge, last checked, due — "Due" / "Overdue since <date>" when
  `isDue`, blank otherwise); `<details>` "New tool" (`ToolForm`, student+); **Recent checks**
  (`ToolCheckTable`, last 50); retired tools in a collapsed `<details>`.
- `src/app/tools/[id]/page.tsx` (student+; `notFound()` when `getTool` is null, as
  `batteries/[id]`): spec card incl. status, interval, last checked, next due; `<details>` "Edit
  tool" (`ToolForm initial=`, status select lives here; student+); per-tool `ToolCheckTable`;
  a **Danger zone** row at the bottom: when `hasPendingDeleteRequest` → `<span className="pill">
  Deletion requested</span>` (everyone); mentor+ → `DeleteToolButton`; student without a pending
  request → `ToolDeleteRequestForm`.
- `ToolForm.tsx` — create + edit, POST/PATCH, inline 409 "Asset tag already exists". Copy
  `BatteryForm.tsx`; status `<select>` shown in edit mode only.
- `ToolCheckForm.tsx` — tool `<select>`, `datetime-local` checkedAt (default now), kind,
  condition (default good), "Set tool status to" `<select>` with "— No change —" default plus
  the three non-retired statuses, notes. Copy `UsageLogForm.tsx`.
- `ToolCheckTable.tsx` — checked at, tool (link; omitted on detail page via optional `toolNames`
  map), kind, condition, status after, by, notes, mentor Delete button (`DeleteCheckButton.tsx`,
  copy of `DeleteUsageButton.tsx` hitting `/api/tool-checks/[id]`).
- `DeleteToolButton.tsx` — `DeleteUsageButton` with `confirm("Delete this tool and its check
  history?")`, `DELETE /api/tools/[id]`, then `router.push("/tools")`.
- `ToolDeleteRequestForm.tsx` — copy `ExcusalRequestForm.tsx`: one required reason `<textarea>`
  (maxLength 500), POST `/api/tool-delete-requests`, states sent / 409 "Already requested" /
  error; `router.refresh()` on success so the pill appears.
- `RequestActions.tsx` — add `ToolDeleteRequestActions({ requestId })`, a copy of
  `ExcusalRequestActions` posting to `/api/admin/requests/tool-delete/${requestId}`.
- `src/app/admin/requests/page.tsx` — add `listPendingToolDeleteRequests()` to the `Promise.all`
  and a **Tool deletion requests (n)** section after Excusal requests, visible to mentor+ (not
  `isAdmin`-gated): Tool (link `/tools/[id]`), Requested by, Reason, Requested (`teamTz`), Actions.
- `src/app/admin/page.tsx` — add `listPendingToolDeleteRequests()` to its `Promise.all` and its
  `.length` to `requestsCount` in **both** branches (~L117); hint text gains "tool-deletion".
- Status badge: `<span className="pill">` (exists in `src/app/globals.css` ~L385) with the status
  text, underscores replaced by spaces. No per-status colour variants in v1.
- Nav: **three** places in `src/components/SiteNav.tsx`, each directly after the Batteries
  entry, same `(isStudent || isMentor || isAdmin)` gate and `--hue-shopfloor`: sidebar `NavLink`
  (~L246), `RailItem` (~L325), mobile sheet `Link` (~L404). New `Icon.tsx` glyph `tools`
  (one path entry — do not reuse `wrench`, the rail already uses it for Shop).

## 7. Tests

Unit `src/lib/tools.test.ts` (QueryStub copied from `batteries.test.ts`): `parseToolInput`
(valid; empty name; bad status; `maintenanceIntervalDays: 0`; blank optionals → null);
`parseCheckInput` (valid with `statusAfter` null; `"retired"` rejected; bad kind; bad condition;
non-uuid tool; `checkedAt` omitted → now); `nextDueAt` (no interval → null; retired → null;
never checked → `createdAt`; checked → `+interval days`, exact ISO); `sortByLastChecked`;
`createTool` 23505 → 409; `createCheck` 23503 → 400; `deleteTool` no row → 404.

Unit `src/lib/tool-delete-requests.test.ts` (mirror `excusal-requests.test.ts`):
`parseToolDeleteRequestInput` (valid; missing reason; 501-char reason; non-uuid tool);
`createToolDeleteRequest` (ok returns id; 23505 → 409; 23503 → 400); `reviewToolDeleteRequest`
(approve marks approved **then** deletes — assert call order; deny marks denied and deletes
nothing; 404 missing; 409 already decided; 409 guarded update matched nothing; approve with
`deleteTool` 404 → ok).

E2E `e2e/tools.spec.ts` (copy `e2e/batteries.spec.ts` shape; student and mentor contexts via
`e2e/helpers/session.ts`): student `POST /api/tools` → 201 (keep the id); duplicate asset tag →
409; student `/tools` shows the tool **and** "New tool"; student logs a check with condition
`poor` and status `out_of_service` → row appears with "Test Student" and the tool row now shows
`out_of_service` (**this is the only test of the trigger**); student PATCHes the tool to
`retired`, then `POST /api/tool-checks` against it with `statusAfter: "in_service"` → 201 but
the tool stays `retired`; student `DELETE /api/tools/[id]` → 403; student `POST
/api/tool-delete-requests` → 201 (keep the request id), again → 409; student `/tools/[id]`
shows "Deletion requested"; mentor `/admin/requests` shows the tool name; mentor **denies** →
tool still 200; student re-requests → 201 (new id); mentor **approves** that one → `/tools/[id]` → 404 for the
mentor (checks and request cascaded); guest `/tools` → `/login`. `finally`: mentor `DELETE
/api/tools/[id]`, tolerating 404.

## 8. Alternatives considered

- **App-level status flip / stored `next_due_at`:** non-atomic or denormalised; the trigger and
  the computed embed are each a handful of lines. Rejected (§1.4, §1.5).
- **Soft-delete (`retired`) instead of a request flow:** students can already retire; the request
  exists for the "this row is junk / a duplicate" case where a row should not exist. Hard delete
  behind mentor review is the smallest thing that does that.
- **One generic `ReviewActions({ endpoint })`** replacing the three existing siblings: reasonable
  refactor, out of scope; add the fourth sibling as instructed.

## 9. Trade-offs and risks

- Trigger logic is invisible to vitest; only the e2e proves it. Keep that assertion.
- The trigger ignores `checked_at`: a backdated check with `statusAfter` still overwrites the
  current status. Acceptable for v1 (fix via PATCH); named so nobody is surprised.
- `never checked → due now` means bulk-entering tools with intervals shows everything as
  overdue on day one. Intended (baseline inspection), but say so in the feature doc.
- Students can edit anything (incl. retire) but not delete; a bad edit is recoverable, a delete
  is not. That is the whole reason for the request flow.
- **Approved requests never survive** (cascade with the tool); denied ones do. A mentor clicking
  Delete on `/tools/[id]` while a request is pending cascades it away unreviewed — acceptable,
  the request's purpose is met. Nothing user-visible is lost: the queue lists pending only.
- `reviewToolDeleteRequest` order (mark → delete) is the opposite of `reviewExcusalRequest`
  (create → mark). An implementer copying "exactly" will invert it; §3 says why not to.
- `merge_person` copy drift: copy from the *latest* file or a prior FK reassignment is lost.
- Migration version collision with parallel worktrees (see memory note): check origin/master.

## 10. Tasks (each sized for a fresh subagent; 1 → 2 → {3, 7} → 4 → {5, 6} → {8, 9})

1. **coder** — Migration `supabase/migrations/20260906130000_tool_maintenance.sql` (§2: three
   tables, indexes, trigger, `merge_person` re-declared from `20260903120000_battery_tracking.sql`
   + three lines) and types in `src/lib/types.ts` (§2, incl. `ToolDeleteRequest*`). Verify with
   `./dev npm run db:reset`, then `psql` in `./dev bash`: check with `status_after` flips the
   tool; second pending request for one tool → 23505; deleting the tool removes its check and
   request rows.
2. **coder** — `src/lib/tools.ts` (§3, §4, incl. `deleteTool`) + `src/lib/tools.test.ts` (§7).
   `./dev npm run test`.
3. **coder** — `src/lib/tool-delete-requests.ts` (§3; imports `deleteTool` from task 2) +
   `src/lib/tool-delete-requests.test.ts` (§7). `./dev npm run test`.
4. **coder** — Routes (§5): `src/app/api/tools/route.ts`, `src/app/api/tools/[id]/route.ts`
   (PATCH student + DELETE mentor), `src/app/api/tool-checks/route.ts`,
   `src/app/api/tool-checks/[id]/route.ts`, `src/app/api/tool-delete-requests/route.ts`,
   `src/app/api/admin/requests/tool-delete/[id]/route.ts`. Copy the battery / excusal route
   files. `./dev npm run typecheck`.
5. **coder** — Components `ToolForm`, `ToolCheckForm`, `ToolCheckTable`, `DeleteCheckButton`,
   `DeleteToolButton`, `ToolDeleteRequestForm` and pages `src/app/tools/page.tsx`,
   `src/app/tools/[id]/page.tsx` (§6). Verify in browser at this worktree's `APP_PORT`
   (dev-login): student sees New tool / Edit tool / Request deletion and the pill after
   requesting; mentor sees Delete.
6. **coder** — Admin queue (§6): `ToolDeleteRequestActions` in `RequestActions.tsx`, the section
   in `src/app/admin/requests/page.tsx`, `requestsCount` + hint in `src/app/admin/page.tsx`.
   Verify in browser as mentor: approve removes the tool, deny keeps it.
7. **mechanic** — `src/components/SiteNav.tsx` three entries + `src/components/ui/Icon.tsx`
   `tools` glyph (§6 Nav). `./dev npm run lint && ./dev npm run typecheck`.
8. **coder** — `e2e/tools.spec.ts` (§7 e2e). `./dev npm run e2e -- tools.spec.ts`.
9. **mechanic** — Docs: `docs/features/tool-maintenance.md` (mirror
   `docs/features/battery-tracking.md` sections: inventory, check log, deletion requests, roles,
   pages, future work, source); one line in `docs/features.md` after the Battery tracking entry;
   fill the empty `**Decision:**` at `docs/research/02-feature-catalog.md:411` in the existing
   `Need/Nice · Preferred variant: …` format (Nice · catalog + check log only, no checkout;
   FM condition/interval fields, OT status enum). Run `graphify update .` after code lands.

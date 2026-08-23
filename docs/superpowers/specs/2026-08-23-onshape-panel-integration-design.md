# Onshape right-panel integration (issue #95, v1)

Registers a hub page as an Onshape **Element right panel** extension so a
designer, without leaving CAD, sees the parts in the current Onshape tab with
their hub tracking state and can create/track hub parts directly from the
selected geometry. Source of ideas: `docs/research/sources/austinbowles29-cheesy-parts.md`
(cheesy-parts is **unlicensed / all-rights-reserved — ideas only, no code copied**;
every mechanism below is reimplemented from behavior descriptions). Issue:
https://github.com/RAR1741/hub/issues/95.

## Problem & constraints

The hub has a full parts domain (`project`/`part` tables, 22-status pipeline,
`src/lib/parts.ts`) but no way to create or track parts from inside Onshape,
where designers actually work. cheesy-parts solves this with an Onshape-embedded
panel — but it uses Airtable, has no login wall, and stores Onshape tokens in
browser cookies. We adapt the *idea* onto the hub's existing DB and auth.

Approved product decisions (from brainstorming, do not revisit):

1. **Onshape API via per-user OAuth2** (scope `OAuth2Read` only), tokens stored
   **server-side** in a new table and **silently refreshed** (cheesy-parts never
   implemented refresh — we do). No Onshape tokens in the browser.
2. **List-first panel.** The panel lists the parts in the current Onshape
   element, each showing its hub status badge (if tracked) or an Add button.
   Duplicate detection is inherent — a linked part shows status, not Add.
3. **Hub allocates part numbers; no write-back to CAD** in v1. Onshape's own
   part-number property is shown read-only if present.
4. **One-time Connect popup** for hub identity. The iframe is cross-origin on
   onshape.com and the hub session cookie is `SameSite=Lax`, so it is never sent
   in the iframe. A popup (first-party context) logs the user into the hub
   normally, then mints a **panel token** handed back via `postMessage`.
5. Panel access is **student+**, same as parts CRUD.

Deferred (extension points named, nothing built): Slack notifications, live
`SELECTION` via Client Messaging, drawing PDF export/attachments, part-number
write-back to CAD, BOM part-number fallback.

Repo constraints this design obeys:

- Migrations in `supabase/migrations/`, house style: `uuid primary key default
  gen_random_uuid()`, RLS enabled with **zero policies** (service-role-only),
  why-comments in the DDL, no GRANTs (default privileges from
  `20260811101553_service_role_grants.sql` cover new tables). Never edit an
  applied migration in place.
- Data access in `src/lib/*.ts` with colocated `*.test.ts` (Vitest, TDD): pure
  `parseXInput(body): Input | null` validators on `src/lib/validate.ts`; async
  mutators returning `{ok, status, ...}`; error mapping 23503→400, 23505→409.
- Routes wrapped in `withRole("student", ...)` (`src/lib/api.ts`).
- Client components submit via `fetch()` to API routes then `router.refresh()`;
  no server actions; no toast lib (inline `<p className="text-[var(--red)]">`);
  Tailwind v4 + `globals.css` component layer (`.card`/`.btn`/`.input`/
  `.status-*`); theme via CSS custom properties.
- Everything runs in Docker via `./dev`; schema applies via `./dev npm run db:reset`.

## 1. Data model — one migration

`supabase/migrations/<ts>_onshape.sql`:

```sql
-- Per-person Onshape OAuth tokens. Server-only (RLS zero-policy); the refresh
-- token lets the server mint fresh ~1h access tokens for months so a designer
-- connects Onshape once. Deleting the person removes their connection.
create table onshape_connection (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references person (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table onshape_connection enable row level security;
-- Deliberately NO policies: default-deny; all access via service role.

-- Onshape linkage on part. Identity of a CAD part is the triple
-- (document, element, part id); the URL is the deep link captured at create.
alter table part
  add column onshape_document_id text,
  add column onshape_element_id text,
  add column onshape_part_id text,
  add column onshape_url text;

-- Duplicate-link guard: one hub part per CAD part. Partial so the many
-- non-Onshape parts (all NULL) don't collide. Also the lookup index for
-- "which hub part is this CAD part?" (panel context matching). 23505 -> 409.
create unique index part_onshape_identity_unique
  on part (onshape_document_id, onshape_element_id, onshape_part_id)
  where onshape_part_id is not null;
```

Types/mappers in `src/lib/types.ts`: `OnshapeConnectionRow`/`OnshapeConnection`/
`onshapeConnectionFromRow`; extend `PartRow`/`Part`/`partFromRow` with the four
`onshape*` columns (snake→camel).

## 2. Auth — two flows, one popup

### Hub identity: the panel token

The panel (iframe on onshape.com) shows a **Connect** card → opens a popup to
`/onshape/connect`. That page is first-party (top-level window), so the normal
hub login works there (Google OAuth redirect, student-ID form, or dev-login).
Once the viewer is student+, the page mints a **panel JWT** and posts it to the
opener, then continues to the Onshape OAuth step (§below) or closes.

- **Panel JWT** — `src/lib/onshape-panel-token.ts`, same `jose`/HS256 pattern
  and `STUDENT_SESSION_SECRET` as `src/lib/student-session.ts`:
  `createPanelToken(personId)` → `{ sub, kind: "onshape-panel" }`, 90-day expiry;
  `verifyPanelToken(token)` → `{ personId } | null` (rejects wrong `kind`).
- Panel stores it in **`localStorage`** (survives the iframe reload Onshape does
  on every selection change) and sends `Authorization: Bearer <token>` on every
  panel/API call.
- **`resolveViewer()` gains one dep** (`src/lib/viewer.ts`): a `panelToken`
  read from the `Authorization: Bearer` header, verified with `verifyPanelToken`,
  resolved via the existing `findPersonById` with a **fresh `is_active`/role
  lookup per request** — removing someone from the roster instantly revokes
  panel access, no token bookkeeping. Resolution order: supabase user →
  student cookie → **panel bearer** → guest. `getViewer()` reads the header from
  `next/headers`. Because this rides `resolveViewer`, **every existing
  `withRole("student")` API works from the panel unchanged** (inline status
  change reuses `PATCH /api/admin/parts/[id]` as-is).

### Onshape identity: per-user OAuth, server-side tokens

Same popup, after hub login: if the person has no `onshape_connection`, the page
sends them through `/api/onshape/oauth/start` → oauth.onshape.com (scope
`OAuth2Read`) → `/api/onshape/oauth/callback`. Callback exchanges the code and
**upserts** tokens into `onshape_connection` keyed by `person_id`, then closes
the popup / signals the panel to refetch. CSRF via a short-lived signed state
cookie; `returnTo` validated as a same-app relative path.

`src/lib/onshape.ts`:
- Config from env (below); `clientId()` maps `0`→`O` (Onshape client-id quirk).
- `buildAuthorizeUrl(state)`, `exchangeCode(code)`, and
  `getFreshAccessToken(personId)` — reads the connection, and if `expires_at`
  is within 60s, POSTs `grant_type=refresh_token`, updates the row, returns the
  new token; a 401 on an API call triggers one refresh-and-retry.
- **One API call in v1:** `listElementParts(personId, ctx)` →
  `GET {base}/v6/parts/d/{did}/{wvm}/{wvmId}?elementId={eid}&includePropertyDefaults=false&withThumbnails=false`
  returning `[{ partId, name, material, onshapePartNumber }]`. 401/403 →
  `{ needsReconnect: true }`.
- Helpers: `discardOnshapeToken(v)` (returns undefined when `v` fully matches
  `^\{\$[^}]+\}$` — Onshape leaves literal `{$partId}` when unsubstituted);
  `normalizeServer(v)` (accepts only `onshape.com`/`*.onshape.com` origins).

## 3. Server routes

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/onshape/oauth/start` | GET | student+ (bearer or cookie) | State cookie + 307 to authorize URL. |
| `/api/onshape/oauth/callback` | GET | (state cookie) | Exchange code, upsert connection, close/redirect. |
| `/api/onshape/panel/context` | GET | student+ | Takes Onshape ctx params (token-discarded). Returns `{ connectionState: "connected"\|"needs_connect"\|"needs_reconnect", parts: [{ partId, name, material, onshapePartNumber, hubPart: { id, fullPartNumber, status } \| null }], projects: [{ id, name, assemblies: [{ id, name, fullPartNumber }] }] }`. Hub-part match via the linkage index; projects+assemblies feed the create form. |
| `/api/onshape/panel/parts` | POST | student+ | `parseOnshapePartInput` → create via existing `createPart` numbering path, writing the four linkage columns. Duplicate linkage → 409. Returns `{ id, fullPartNumber }`. |

Panel context/create live in `src/lib/onshape.ts` + `src/lib/parts.ts`
(reuse `createPart`; add `findPartByOnshapeIdentity` and a linkage-aware create
wrapper or extend `PartInput`). Validators pure, `null` = invalid, colocated
tests.

## 4. Panel UI

- `src/app/onshape/page.tsx` — server component, `force-dynamic`, reads
  searchParams through `discardOnshapeToken`, renders `<OnshapePanel>` with the
  parsed context. Skeleton `loading.tsx`.
- `src/app/onshape/connect/page.tsx` — the popup target: runs hub login gate,
  mints panel token, postMessages to opener (origin-checked), drives the Onshape
  OAuth step, self-closes.
- `src/components/OnshapePanel.tsx` (client) — Connect/Reconnect card →
  parts list → per-part Add form (name+material prefilled; project + parent-
  assembly selects) → linked view (status badge + inline status `<select>`
  reusing the `PartStatusCell` PATCH pattern + deep link to
  `/admin/parts/[id]`). Uses existing `.card`/`.btn`/`.input`/`.status-*`
  classes; inline errors; no toast lib.
- **SessionStorage cache** of the last context response (30-min TTL, key =
  normalized context params) for instant warm paint across selection-change
  reloads. Dirty-field awareness is unnecessary here because the create form
  opens per-part on demand (metadata is already resolved before it opens).

## 5. Dev / test strategy

- **Dev-gated Onshape mock** `src/app/api/dev/onshape-mock/*` (token endpoint +
  parts-list endpoint), guarded exactly like `dev-login` (404 in production).
  Local `.env` points `ONSHAPE_TOKEN_URL`/`ONSHAPE_API_BASE_URL` at it, so the
  entire flow (connect → list → create → status change) is drivable locally and
  in Playwright **with zero real Onshape dependency**.
- Unit tests (Vitest, TDD): panel-token mint/verify + wrong-kind rejection;
  `resolveViewer` bearer branch + fresh-role revocation; `discardOnshapeToken`;
  `normalizeServer`; refresh-when-expired; `parseOnshapePartInput`;
  `findPartByOnshapeIdentity`; duplicate-linkage 409.
- `e2e/onshape-panel.spec.ts` — self-seeding (dev-login + mock): open `/onshape`
  with hand-built context params, Connect, see parts list, Add a part (asserts
  hub number renders + linkage stored), change its status inline, reopen →
  the part now shows as tracked (no Add).
- Real in-Onshape verification is a **manual** step (see §7).

## 6. Env vars (`.env.example` + Vercel)

`ONSHAPE_CLIENT_ID`, `ONSHAPE_CLIENT_SECRET`, `ONSHAPE_REDIRECT_URI`
(`https://hub.redalert1741.org/api/onshape/oauth/callback`),
`ONSHAPE_AUTHORIZATION_URL` (default `https://oauth.onshape.com/oauth/authorize`),
`ONSHAPE_TOKEN_URL` (default `https://oauth.onshape.com/oauth/token`),
`ONSHAPE_API_BASE_URL` (default `https://cad.onshape.com/api`),
`ONSHAPE_SCOPES` (default `OAuth2Read`). Reuses `STUDENT_SESSION_SECRET` for the
panel token.

## 7. Manual setup (Jordan — cannot be automated)

In Onshape Developer Settings: (1) create an OAuth application — redirect URL
`https://hub.redalert1741.org/api/onshape/oauth/callback`, scope `OAuth2Read`;
(2) add an **Element right panel** extension, context *Inside part studio*,
action URL
`https://hub.redalert1741.org/onshape?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&partNumber={$partNumber}`;
(3) assign the app to the team via admin assignment (no App Store listing
needed for a private team app); (4) set the Vercel env vars. Note: right panels
do **not** receive `{$partId}` — the panel resolves the part list from the API,
matching hub links by the stored identity triple.

## 8. Task breakdown (subagent execution order)

| # | Task | Agent | Depends on |
|---|---|---|---|
| 1 | Migration `<ts>_onshape.sql` (§1) + types/mappers in `types.ts`; `./dev npm run db:reset` replays clean. | coder | — |
| 2 | Auth core (TDD): `onshape-panel-token.ts`, `resolveViewer` bearer branch + `getViewer` header read, `onshape.ts` config/authorize/exchange/refresh/`listElementParts` + `discardOnshapeToken`/`normalizeServer`. Unit tests. | coder | 1 |
| 3 | OAuth routes + connection upsert: `/api/onshape/oauth/start`, `/callback`. | coder | 2 |
| 4 | Panel APIs (TDD): `/api/onshape/panel/context`, `/api/onshape/panel/parts` (+ `parseOnshapePartInput`, `findPartByOnshapeIdentity` in `parts.ts`). | coder | 2 |
| 5 | Dev Onshape mock `/api/dev/onshape-mock/*` + `.env.example` wiring. | coder | 2 (parallel with 3,4) |
| 6 | Panel UI: `/onshape` page + `loading.tsx`, `/onshape/connect`, `OnshapePanel.tsx`, sessionStorage cache, any `globals.css`. | coder | 3,4,5 |
| 7 | E2E `e2e/onshape-panel.spec.ts` + manual-setup doc section; full gate suite. | coder | 6 |
| 8 | Adversarial review → fixes; verify; PR + monitor. | reviewer / me | 7 |

Each task commits at its checkpoint and pushes (repo git workflow).

## 9. Verification plan

In-container gates (all pass before PR):

    ./dev npm run db:reset
    ./dev npm run lint
    ./dev npm run typecheck
    ./dev npm run test
    ./dev npm run e2e

Manual: register a dev extension pointing at the worktree URL, open a Part
Studio, Connect, confirm the parts list + create + status change round-trip.

## Alternatives considered

- **Server-held API key instead of per-user OAuth** — rejected in brainstorming:
  per-user OAuth spreads API quota per designer and attributes any future
  write-back to the real user; the refresh flow makes it one-time UX anyway.
- **Loosen hub cookie to `SameSite=None`** — rejected: broken on Safari,
  weakens app-wide CSRF posture; the Connect popup works everywhere.
- **Create-only submit form (closer to cheesy-parts)** — rejected: the
  list-first panel makes duplicate detection inherent and shows tracking state,
  which is the fluid-UX centerpiece.
- **Write hub number back to CAD** — deferred: needs `OAuth2Write`, workspace-
  only contexts, read-only-version handling; not v1.

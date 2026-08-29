# Realtime updates via Supabase Broadcast (kiosk + who's-here)

**Date:** 2026-08-28
**Issue:** [#27](https://github.com/RAR1741/hub/issues/27)
**Status:** Approved design, pending implementation plan

## Problem

Two staleness problems share one cause — screens that only learn about
sign-in/out changes by polling (or not at all):

1. The who's-here dashboard widget (`WhosHere.tsx`) polls `/api/whos-here`
   every 30 s (issue #27 tracks upgrading this to push).
2. The kiosk board (`/kiosk`) never re-fetches: it is server-rendered and only
   refreshes after its *own* clock-in/out. With 3 kiosks at the shop, a
   sign-in on kiosk A is invisible on kiosks B/C until a manual page refresh.

Constraints from review: no additional cost, no new infrastructure, testable
locally, and — although today's events carry no data — the design must be able
to carry real payloads later without a redesign.

## Decision

Use **Supabase Realtime Broadcast** over **private channels** in a
**ping-then-refetch** pattern:

- After a successful mutation, the server route POSTs a broadcast message to
  Supabase's HTTP broadcast endpoint (no websocket held server-side).
- Clients subscribe to the channel over a websocket; on receiving an event
  they re-fetch through the **existing server routes** (`router.refresh()` or
  the existing JSON endpoints). No table data ever travels over the socket
  today, and no RLS policies are added to any data table.
- Channels are **private**: joining requires a short-lived JWT minted by a new
  server route, available only to registered kiosks and logged-in viewers.
  The anon key alone can neither subscribe nor send.

A spike (2026-08-28, this branch) verified end-to-end: browser subscribe
through the local container seam, server HTTP send from inside the container,
and prod send/receive — all pass with existing deps and env
(`@supabase/supabase-js`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
already present).

### Why not the alternatives

- **Faster/adaptive polling:** 3+ always-on kiosks polling 10 s around the
  clock is ~780 k Vercel invocations/month of mostly-idle traffic. Broadcast
  makes idle cost ~zero on both Vercel and Supabase (well inside free-tier
  quotas: 200 concurrent connections, 2 M messages/month vs our ~10
  connections and <100 k messages/month).
- **`postgres_changes`:** requires the anonymous SELECT RLS policy described
  in #27, breaking the zero-policy/service-role-only stance. Broadcast needs
  no data-table policies.
- **SSE/WebSockets on Vercel functions:** billed for connection hold time,
  300 s duration cap forces reconnect churn, and the server would still have
  to poll the DB. Strictly worse.

## Architecture

### Topics and events (the future-proofing seam)

One channel topic per domain, prefixed `hub:`. Events are named per change
kind; payloads are JSON and may be empty.

- Topic now: `hub:presence`. Events: `clock-in`, `clock-out`, each with
  payload `{}` today.
- Later, a payload can be added to an existing event (e.g.
  `{ personId, name, since }`) or a new topic added (e.g. `hub:parts` for the
  shop board) **without changing any plumbing** — the hook already delivers
  `(event, payload)` to its consumer; today's consumers ignore both and
  re-fetch. Private channels mean a future data-carrying payload is already
  authorized-subscribers-only.

Consumers must stay correct if they miss events (dropped socket) — payloads
are an optimization, refetch is the source of truth. That rule is what makes
"add data later" a non-redesign.

### Server: `src/lib/realtime.ts`

```ts
export async function broadcast(topic: string, event: string, payload: object = {}): Promise<void>
```

- POST `${serverSupabaseUrl()}/realtime/v1/api/broadcast` with the
  service-role key (`apikey` + `Authorization: Bearer`), body
  `{ messages: [{ topic, event, payload, private: true }] }`.
- **Fire-and-forget:** failures are logged (`console.error`) and never fail
  the calling mutation. A missed ping degrades to the fallback poll.
- Short timeout (~2 s, `AbortSignal.timeout`) so a Realtime outage can't slow
  clock-ins.

Called from `POST /api/kiosk/clock-in` and `POST /api/kiosk/clock-out` after
their successful writes. (Admin session edits also change who's-here; wiring
`broadcast()` into those routes is a one-liner each and in scope.)

### Auth: `GET /api/realtime-token`

- Authorization: registered kiosk cookie (`verifyKioskToken`) **or** logged-in
  viewer (`getViewer`), reusing the same gate as `/kiosk` page access. 401
  otherwise.
- Mints an HS256 JWT via `node:crypto` (no new dependency):
  `{ role: "authenticated", exp: now + 1h, iat, iss: "hub-realtime" }`,
  signed with `SUPABASE_JWT_SECRET`.
- Response: `{ token, expiresAt }`. Never cached.

Env: `SUPABASE_JWT_SECRET` added to `.env` locally (standard local-stack
secret) and to Vercel from the Supabase dashboard (legacy JWT secret). Missing
secret → route 503s and clients silently stay on fallback polling.

### Migration: authorize private-channel reads

One new migration adding a single policy on Realtime's own message table
(not a data table — the zero-policy rule for data tables is unchanged):

```sql
create policy "authenticated can receive hub broadcasts"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() like 'hub:%');
```

No INSERT policy: clients never send; the service key (server) bypasses RLS.

### Client: `src/hooks/useRealtimeRefetch.ts`

```ts
useRealtimeRefetch(topic: string, refetch: () => void, opts?: { fallbackMs?: number })
```

One hook, used by both consumers. Responsibilities:

1. Fetch a token from `/api/realtime-token`; call
   `supabase.realtime.setAuth(token)`; subscribe to `topic` with
   `{ config: { private: true } }`.
2. On any broadcast event: call `refetch`, **debounced to at most once per
   2 s** (also bounds ping-spam from a compromised token).
3. **Token refresh:** re-fetch the token and `setAuth` ~5 min before expiry
   (kiosks run for days).
4. **Fallback poll:** call `refetch` every `fallbackMs` (default 5 min)
   regardless of socket state — the correctness backstop for silently dead
   websockets. Also refetch once on every (re)`SUBSCRIBED` transition to catch
   events missed while disconnected.
5. On token-fetch failure or `CHANNEL_ERROR`/`TIMED_OUT`: retry with capped
   exponential backoff (max ~1 min); the fallback poll keeps running
   throughout, so worst case ≈ today's behavior (a slow poll).
6. Single browser Supabase client module-level singleton
   (`createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)`)
   — realtime-only; **no** `@supabase/ssr`, no auth cookies, so the
   `AUTH_COOKIE_NAME` seam is untouched.

### Consumers

- **`KioskBoard`**: `useRealtimeRefetch("hub:presence", () => router.refresh())`,
  with refresh skipped while a clock-in/out request is in flight (`busy`).
  Client state (search text, flash) survives `router.refresh()`. The 30-line
  board keeps its existing own-action `router.refresh()` as the instant local
  echo.
- **`WhosHere`**: replace the 30 s `setInterval` with
  `useRealtimeRefetch("hub:presence", refetchHere)` where `refetchHere` is the
  existing `/api/whos-here` fetch. Keep-last-good-data on failure, as today.
- **`ShopBoard`**: out of scope; its 10 s poll stays. Follow-up issue can move
  it to a `hub:parts` topic on this plumbing.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Broadcast POST fails/times out | Logged; mutation still succeeds; others catch up via fallback poll |
| Token route down / secret missing | Hook stays on 5-min fallback poll |
| Websocket drops silently | Fallback poll bounds staleness at 5 min; refetch-on-resubscribe closes the gap on reconnect |
| Ping flood (stolen token) | Client debounce caps refetch at 1/2 s; tokens expire in 1 h |

## Testing

- **Unit:** JWT mint (shape, expiry, signature verifiable with the local
  secret); `broadcast()` (correct endpoint/headers/body, swallows failures) —
  both with mocked `fetch`; token route authz (kiosk cookie / viewer / 401).
- **E2E (Playwright):** two contexts on `/kiosk` — clock in from context A,
  assert context B shows the person "on the clock" without a reload
  (generous timeout; local realtime verified working by the spike).
- **Manual:** two browser tabs locally; after deploy, two real kiosks.

## Rollout

- Spike files (`spike-prod-realtime.mjs`, `src/app/spike-realtime/`) are
  deleted as part of implementation.
- Prod steps at merge: set `SUPABASE_JWT_SECRET` in Vercel; `supabase db push`
  the `realtime.messages` policy migration. No Supabase plan change; Realtime
  is already enabled.
- Closes #27 (who's-here push) and the cross-kiosk staleness problem.

# Self-service excusal requests

A student can ask for an excused absence themselves instead of waiting on a mentor to enter one.

## Requesting

On `/me/attendance` (`src/app/me/attendance/page.tsx`), the **Request excusal** card
(`ExcusalRequestForm`, `src/components/ExcusalRequestForm.tsx`) lets a signed-in member pick a date
(past or future) and an optional reason (≤ 500 chars), then `POST`s `/api/excusal-requests`
(`src/app/api/excusal-requests/route.ts`).

- The request is always scoped to the signed-in viewer (`getViewer().person.id`) — the person ID is
  never read from the request body, so there's no way to request on someone else's behalf.
- The route is rate-limited to 5 requests/minute per IP (`createRateLimiter`,
  `src/lib/rate-limit.ts`) and returns 401 if the viewer has no linked person.
- `parseExcusalRequestInput` (`src/lib/excusal-requests.ts`) validates the body: `date` must be a
  parseable `YYYY-MM-DD` string, `reason` must be present (it can't be blank once trimmed) and
  ≤ 500 chars. An invalid body is a 400.
- A member can have at most one **pending** request per date — enforced by the partial unique index
  `one_pending_excusal_request_per_person_date` on `excusal_request (person_id, date) WHERE status =
  'pending'` (`supabase/migrations/20260813005617_excusal_requests.sql`). A duplicate insert returns
  Postgres error `23505`, which the API surfaces as `409`, rendered client-side as "You already have
  a pending request for that date." Re-requesting the same date is allowed once the earlier request
  has been approved or denied.

The **My excusal requests** card below it (`ExcusalRequestList`,
`src/components/ExcusalRequestList.tsx`) lists the member's own requests
(`listExcusalRequestsForPerson`), newest first, each with a status pill (pending/approved/denied)
and its reason if one was given.

## Missed-day nudge

The **missed required build days** section on the same page (`MissedDaysExcusal`,
`src/components/MissedDaysExcusal.tsx`) lists each required build day, in the past, where the viewer
has no session and no existing excusal. Each row has a **Request excusal** button that opens an
in-page modal pre-filled with that date, posting to the same `/api/excusal-requests` endpoint — one
click from "I missed this" to "I've asked for an excusal." A date that already has a pending request
shows a "Pending excusal" pill instead of the button (`pendingDates` — the viewer's own pending
request dates, passed down from the page).

Note: this is a client-side modal, not a `/me/attendance?date=...` deep link — no route accepts a
`date` query param.

## Mentor review

Mentors and admins review pending requests on `/admin/requests` (`withRole("mentor")`-gated), in an
**Excusal requests** table listing each pending request's requester, date, and reason
(`listPendingExcusalRequests` — uses the `person!person_id` FK-hint embed since `excusal_request` has
two person FKs, `person_id` and `reviewed_by`, so an unqualified embed is ambiguous to PostgREST).

Approve/deny goes through `POST /api/admin/requests/excusal/[id]` with `{ "action": "approve" |
"deny" }` (`src/app/api/admin/requests/excusal/[id]/route.ts` → `reviewExcusalRequest` in
`src/lib/excusal-requests.ts`):

- **Approve** creates a real `excusal` row (via the existing `createExcusal`), so attendance math
  treats it exactly like a mentor-entered excusal, with no separate code path.
- **Deny** just records the decision.
- Both paths guard against re-deciding an already-reviewed request: the row is re-fetched, checked
  for `status === "pending"`, and the final update is qualified with `.eq("status", "pending")` so a
  concurrent reviewer racing the same request gets a `409` instead of silently double-processing it.

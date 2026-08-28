# ADR: Slack account linking — name fallback + manual link picker

Status: accepted (decisions pre-settled by orchestrator; this ADR documents them).
Scope: `syncSlackLinks` matching ladder, report persistence, and the Slack admin page.
No DB migration — `person.slack_user_id` and `app_setting` already exist.

## Summary

Slack linking today matches Slack members to hub people by email only
(`src/lib/slack-link.ts`). This change mirrors the FIRST-roster linking flow
(`src/lib/first-sync.ts` + `src/app/admin/first-status/page.tsx`): after the
email pass, still-unmatched members fall back to an exact-normalized full-name
match against currently-unlinked people (claim-once), the sync report is
persisted to `app_setting` key `slack_last_sync_report`, and the Slack admin
page gains an "Unmatched roster entries" section where an admin resolves each
remaining member via a `<SlackLinkPicker>` dropdown that calls the existing
`PUT /api/admin/people/{id}/slack` endpoint.

## Settled decisions (do not re-litigate)

1. **Name matching is exact-normalized only** — `normalizeFull()` from
   `src/lib/name-match.ts`. No `nameKey` (Slack names are freeform, not
   structured first/last), no Levenshtein, no prefix/fuzzy.
2. **Email overwrites, name never does — intentional asymmetry.** The email
   rung stays authoritative and MAY overwrite an existing `slack_user_id`
   (current behavior, slack-link.ts:86-87). The name rung only ever targets
   people with `slack_user_id === null` who weren't already claimed this run.
   Reviewers: this asymmetry is deliberate; do not "fix" it.
3. **Name-ambiguous → `unmatchedSlack`.** A normalized name matching more than
   one unlinked person is NOT a new report field; the member just lands in
   `unmatchedSlack` for the admin picker. `ambiguous` stays email-only.
4. **`SlackMember` gains `name`**, sourced
   `profile.real_name ?? real_name ?? profile.display_name ?? ""`.
5. **Report persisted inside `syncSlackLinks`** to `app_setting` key
   `slack_last_sync_report` (same upsert shape as `first_last_sync_report`);
   `LinkReport` gains `ranAt: string` (ISO).
6. **Admin page reads the persisted report** and renders the picker section;
   picker lists **active people with `slack_user_id === null`** (deliberate
   divergence from `FirstLinkPicker`, which lists ALL people).
7. **Reuse the existing endpoint** `PUT /api/admin/people/{id}/slack` — no new
   route. 409 (`slack_id_taken`) maps to "That Slack user is already linked to
   someone else."
8. **Stale-report self-heal**: the page filters `report.unmatchedSlack` at
   render time against the already-loaded people's `slack_user_id` values.

## Alternatives considered

Pre-settled by the orchestrator, so none are open: fuzzy/`nameKey`/Levenshtein
name matching was rejected because Slack names are freeform (no reliable
first/last split), and a new FIRST-style link route was rejected because
`PUT /api/admin/people/[id]/slack` already does exactly this job, including the
23505 → 409 mapping.

## Design

### `SlackMember` and fetch changes (`src/lib/slack-link.ts`)

```ts
export type SlackMember = { id: string; email: string; name: string };

type RawMember = {
  // ...existing fields...
  real_name?: string | null;
  profile?: { email?: string | null; real_name?: string | null; display_name?: string | null };
};

// in fetchSlackMembers:
const name = m.profile?.real_name ?? m.real_name ?? m.profile?.display_name ?? "";
out.push({ id: m.id, email, name });
```

Expected churn: the existing `fetchSlackMembers` test asserts exact member
objects and must add `name` to its expectations.

### `LinkReport`

```ts
export type LinkReport = {
  ranAt: string; // ISO — NEW
  linked: number;              // email + name links combined
  alreadyLinked: number;
  ambiguous: { email: string; personIds: string[] }[]; // email-only, unchanged
  unmatchedSlack: SlackMember[];                       // now carries name
  unmatchedPeople: { personId: string; name: string }[];
};
```

### Matching ladder in `syncSlackLinks` — two passes, not one interleaved loop

The email rung runs to completion for ALL members before any name matching.
Rationale: in a single per-member loop, member B could name-claim person P and
a later member A could email-overwrite P, silently clobbering B's link with B
appearing in neither `linked` nor `unmatchedSlack`. Two passes make "email is
authoritative, name never overwrites" order-independent. (This is still the
per-member ladder — executed rung-by-rung across members.)

```
load people, identities; build byEmail map           # unchanged
matchedPeople = Set<personId>                        # claim set, shared by both passes
needsNamePass: SlackMember[] = []

# PASS 1 — email (unchanged semantics, may overwrite)
for m of members:
  ids = byEmail.get(m.email)
  if !ids or ids.size === 0:      needsNamePass.push(m); continue
  if ids.size > 1:                report.ambiguous.push(...); continue
                                  # ambiguous email TERMINATES the ladder for m:
                                  # no name fallback, NOT added to unmatchedSlack
  personId = only id
  matchedPeople.add(personId)
  if already linked to m.id:      report.alreadyLinked++; continue
  update person.slack_user_id = m.id   # may overwrite — intentional
  report.linked++

# Build name index AFTER pass 1, over unlinked-and-unclaimed people only:
# nameIndex: Map<normalizedName, Set<personId>>
for p of people where p.slack_user_id === null and !matchedPeople.has(p.id):
  add p.id under normalizeFull(`${p.first_name} ${p.last_name}`)
  if p.display_name: add p.id under normalizeFull(p.display_name)
  # (both keys may map to the same person; a Set dedupes)

# PASS 2 — exact-normalized name, claim-once, never overwrites
for m of needsNamePass:
  key = normalizeFull(m.name)
  if key === "":                report.unmatchedSlack.push(m); continue
  ids = nameIndex.get(key)
  candidates = ids minus matchedPeople        # claimed-this-run are gone
  if candidates.size !== 1:     report.unmatchedSlack.push(m); continue
                                # 0 = no match; >1 = name-ambiguous → picker
  personId = only candidate
  matchedPeople.add(personId)                 # claim-once + unmatchedPeople exclusion
  update person.slack_user_id = m.id
  report.linked++

report.unmatchedPeople = active people with no slack_user_id
                         and !matchedPeople.has(id)     # unchanged expression
report.ranAt = new Date().toISOString()

upsert app_setting { key: "slack_last_sync_report", value: report },
       { onConflict: "key" }                 # mirror first-sync.ts:352-355
if upsert error: throw                       # same as first-sync
return report
```

Notes:

- Keep `matchedPeople.add(personId)` BEFORE the `alreadyLinked` continue in
  pass 1 (as today): the name index reads the pre-pass-1 in-memory snapshot,
  so its correctness depends on `matchedPeople` covering every person pass 1
  touched, including already-linked ones.
- Since the name index is built only over `slack_user_id === null` people, the
  no-overwrite guarantee is structural, but the `!matchedPeople.has` filter is
  still required for claim-once within the run (two same-named members) and to
  exclude people already email-claimed in pass 1.
- Name matches (like email matches) go into `matchedPeople`, so a name-linked
  person also drops out of `unmatchedPeople`.

### Report persistence

Exactly the `first_last_sync_report` pattern in `first-sync.ts`:

```ts
const { error: reportError } = await db
  .from("app_setting")
  .upsert({ key: "slack_last_sync_report", value: report }, { onConflict: "key" });
if (reportError) throw new Error(`slack-link: failed to write sync report: ${reportError.message}`);
```

The test file's `fakeDb` needs an `upsert(values, opts)` method on the object
returned by `from(table)` — capture calls into an `upserts` array
(`{ table, values }`) and return `Promise.resolve({ error: null })`, so the
persistence test can assert table `app_setting`, key
`slack_last_sync_report`, a present `ranAt`, and `name` on `unmatchedSlack`
entries.

### `SlackLinkPicker` (`src/components/SlackLinkPicker.tsx`, new, client)

A near-transcription of `FirstLinkPicker` with these deltas:

- Props: `{ slackUserId: string; people: { id: string; name: string }[] }`.
- Request: `PUT /api/admin/people/${personId}/slack` with body
  `JSON.stringify({ slackUserId })`, `Content-Type: application/json`.
- 409 → `"That Slack user is already linked to someone else."`; other non-OK →
  `body?.error ?? \`HTTP ${res.status}\``; on OK → `router.refresh()`.
- Same select/button/error-span markup and `busy` handling as FirstLinkPicker.

### Slack admin page (`src/app/admin/slack/page.tsx`)

- Also load the report:
  `getSetting<LinkReport | null>("slack_last_sync_report", null, db)`
  (add `getSetting` import from `@/lib/settings`; run alongside the existing
  person select).
- Update the sub-head "Last synced" text from `report?.ranAt` (mirror
  first-status page) — optional but cheap and consistent.
- Build picker options from the already-loaded `people`:
  `people.filter(p => p.is_active && !p.slack_user_id)` mapped to
  `{ id, name: displayName(p) }`, sorted by name.
- **Stale-report self-heal (render-time filter, no extra query):**

  ```ts
  const linkedSlackIds = new Set(people.map(p => p.slack_user_id).filter(Boolean));
  const unmatched = (report?.unmatchedSlack ?? []).filter(m => !linkedSlackIds.has(m.id));
  ```

  This drops a member an admin just manually linked (who would otherwise
  reappear until the next sync) and self-heals races. FIRST tolerates this
  staleness; here we do better — document in a code comment so it isn't
  "simplified away."
- New section "Unmatched roster entries", styled like the first-status page's
  unmatched section: per entry show `m.name` (fall back to `m.id` when empty)
  and `m.email`, plus `<SlackLinkPicker slackUserId={m.id} people={pickerPeople} />`.
  Empty state: "Everything from Slack is linked." (or "Run a sync to see
  unmatched members." when `report` is null).

The persisted report's `unmatchedSlack` entries carry `id`, `email`, and (after
decision 4) `name`, so the section renders directly from the report — no Slack
API call at page render.

## Task list (ordered)

| # | Task | Files | Agent |
|---|------|-------|-------|
| 1 | Extend lib: `SlackMember.name` + RawMember fields, `LinkReport.ranAt`, two-pass ladder (email pass unchanged, name index over unlinked-unclaimed via `normalizeFull`, claim-once, ambiguity→`unmatchedSlack`, empty-name skip), report upsert to `slack_last_sync_report` | `src/lib/slack-link.ts` | coder |
| 2 | Extend tests: fake db `upsert` capture; update `fetchSlackMembers` expectations for `name`; new cases per edge-case list below | `src/lib/slack-link.test.ts` | coder |
| 3 | New `SlackLinkPicker` component per the exact spec above (FirstLinkPicker transcription with PUT URL/body/409-message deltas) | `src/components/SlackLinkPicker.tsx` | mechanic |
| 4 | Admin page: load report via `getSetting`, stale-filter `unmatchedSlack`, picker options = active unlinked people, render "Unmatched roster entries" section, ranAt in sub-head | `src/app/admin/slack/page.tsx` | coder |

## Edge cases → tests (in `slack-link.test.ts`)

1. **Name fallback links**: member email matches no one; `name` normalizes to
   exactly one unlinked person's `first_name + " " + last_name` → linked,
   counted in `linked`, absent from `unmatchedSlack` and person absent from
   `unmatchedPeople`.
2. **display_name match**: name matches a person only via
   `normalizeFull(display_name)` → linked.
3. **Name never overwrites**: name matches a person who already has a
   different `slack_user_id` → no write, member → `unmatchedSlack`.
4. **Name-ambiguous**: name normalizes to two unlinked people → no write,
   member → `unmatchedSlack`, `ambiguous` stays empty.
5. **Claim-once, two same-named members**: two Slack members whose names
   normalize to the same single unlinked person → first claims (linked),
   second → `unmatchedSlack`.
6. **Email claim blocks name claim**: person P email-links to member A;
   member B's name matches P → B → `unmatchedSlack` (P claimed in pass 1).
7. **Ambiguous email terminates the ladder**: member whose email matches two
   people gets NO name fallback and is NOT in `unmatchedSlack` (only in
   `ambiguous`) — even if its name would uniquely match someone.
8. **Empty name**: member with no email match and `name === ""` →
   `unmatchedSlack`, no name-index lookup.
9. **Persistence**: every sync upserts `app_setting` /
   `slack_last_sync_report` with a `ranAt` ISO string and `name`-bearing
   `unmatchedSlack` entries.
10. **fetchSlackMembers name sourcing**: `profile.real_name` wins over
    top-level `real_name` wins over `profile.display_name`, else `""`
    (fold into the existing fetch test).

## Trade-offs & risks

- Exact-normalized matching is conservative: "Jon Smith" vs "Jonathan Smith"
  won't auto-link — that's the picker's job. Accepted.
- The persisted report goes stale between syncs; the render-time filter heals
  the linked-elsewhere case, but a person *unlinked* after a sync won't appear
  in `unmatchedSlack` until the next sync. Same staleness class FIRST already
  tolerates; acceptable.
- Sequential per-person updates (existing pattern) stay as-is; roster is small.

## Migration

None. `person.slack_user_id` (with its unique constraint driving the 23505→409
path) and `app_setting` already exist.

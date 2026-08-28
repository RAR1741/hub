# Kiosk Sign-in/out: Search + Mentor Lane + Role Colors — Implementation Plan

**Goal:** Make the kiosk sign-in/out board fast to operate: an auto-focused search box with Enter-to-act, a dedicated mentor sign-in lane, and student-vs-mentor color coding on the "On the clock" list.

**Architecture:** Server components fetch role-tagged roster data (`src/lib/sessions.ts`); the `KioskBoard` client component owns search state, filtering, and Enter handling. Two role colors live in one source-of-truth module and matching CSS custom properties.

**Tech Stack:** Next.js 16 App Router (RSC + client component), TypeScript, plain CSS in `globals.css`. Container tests via `docker exec team-hub-app-1 npx vitest run`.

## Global Constraints

- Docker dev: run tests with `docker exec team-hub-app-1 npx vitest run`; typecheck with `docker exec team-hub-app-1 npx tsc --noEmit` (ignore pre-existing errors under `.next/dev/types/**`).
- No DB schema/migration changes. No API route changes (clock-in/out already take only `personId`).
- "Mentors" = role !== "student" (mentors + admins), matching the People-page split.
- Role colors are CODE constants, not DB settings — single source of truth, referenced everywhere.
- Do NOT touch `displayName()` behavior or unrelated files.

---

### Task 1: Role color source of truth

**Files:**
- Create: `src/lib/roster-colors.ts`
- Modify: `src/app/globals.css` (`:root` block near the top, alongside existing `--color-*` tokens)

**Interfaces:**
- Produces: `export const ROLE_COLORS = { student: "#4C9DF0", mentor: "#E0A020" } as const;`
  and `export function roleColorVar(role: string): string` returning `"var(--role-mentor)"` when `role !== "student"`, else `"var(--role-student)"`.

Steps:
- Create `src/lib/roster-colors.ts` with `ROLE_COLORS` (student `#4C9DF0`, mentor `#E0A020`) and `roleColorVar`. Add a comment: these hexes and the `--role-*` CSS vars in `globals.css` must stay in sync.
- In `globals.css` `:root`, add `--role-student: #4C9DF0;` and `--role-mentor: #E0A020;`.
- Verify: `docker exec team-hub-app-1 npx tsc --noEmit` clean (excluding `.next/dev/types`).

### Task 2: Plumb role through kiosk data

**Files:**
- Modify: `src/lib/sessions.ts`
- Modify/Create: `src/lib/sessions.test.ts`

**Interfaces:**
- `WhosHereEntry` gains `role: string`.
- `activeMembersForKiosk` returns `{ students: KioskMember[]; mentors: KioskMember[] }` where
  `type KioskMember = { id: string; name: string; role: string }`. Students = `role === "student"`, mentors = everything else. Each list sorted by name.
- `listWhosHere` selects `role` from the joined `person` and includes it per entry.

Steps:
- Add `role` to the `person(...)` select in both `listWhosHere` and `activeMembersForKiosk`.
- Change `activeMembersForKiosk` to return `{ students, mentors }` (split by role), each `{ id, name, role }`, each sorted by name.
- Add `role` to `WhosHereEntry` and its mapping.
- Update `src/app/api/whos-here/route.ts` only if it reshapes entries (pass `role` through; the client uses it for border color).
- Update callers of `activeMembersForKiosk` (kiosk page — Task 3).
- Tests: cover the student/mentor split (a mentor and a student, both active, both not clocked in → land in the right lists) and that `listWhosHere` carries `role`. Use the existing fake-DB/test harness pattern in the repo (see `src/lib/*.test.ts`). If `sessions.test.ts` does not exist, create it following the nearest existing sibling test's harness style.
- Verify: `docker exec team-hub-app-1 npx vitest run src/lib/sessions.test.ts`.

### Task 3: KioskBoard search, mentor lane, role colors

**Files:**
- Modify: `src/components/KioskBoard.tsx`
- Modify: `src/app/kiosk/page.tsx`
- Modify: `src/app/globals.css` (kiosk block ~lines 829-978)

**Interfaces:**
- Consumes: `{ students, mentors }` from `activeMembersForKiosk`, role-tagged `here` from `listWhosHere`, `ROLE_COLORS`/`roleColorVar` from Task 1.

Steps:
- `kiosk/page.tsx`: destructure `{ students, mentors }` and pass `students`, `mentors`, `here` to `KioskBoard`.
- `KioskBoard` props become `{ students, mentors, here }` (each member `{ id, name, role }`; here entries include `role`).
- Add a `search` state string. Render a search `<input>` at the top of `.kiosk-body` (full width, above the columns) with `autoFocus`, `placeholder="Search name…"`, `aria-label="Search names"`. Keep a `ref` to it for refocus.
- Filtering: case-insensitive substring on name. Apply to students, mentors, and here lists independently for display.
- Enter-to-act: on the input's `onKeyDown` for `Enter`, compute the combined filtered matches across all three lists. If exactly one match total, fire its action: if it's a `here` entry → clock-out; otherwise → clock-in. Ignore Enter when 0 or >1 match, or when `busy`.
- After any successful `call()`, clear `search` and refocus the input (in addition to the existing `router.refresh()`), so the board is ready for the next person.
- Layout: three columns — Students (sign-in grid, existing `.k-signin`/`.k-grid`/`.k-name`), On the clock (`.k-here`/`.k-out`), Mentors (new `.k-mentors`, single-column list of `.k-name` buttons calling clock-in). Order left→right: Students · On the clock · Mentors.
- On-the-clock rows: add `style={{ borderLeftColor: roleColorVar(h.role), borderLeftWidth: 4 }}` (or a `data-role` attribute + CSS) so student vs mentor reads at a glance. Keep hover/focus behavior.
- Empty states: students "Everyone active is already signed in.", mentors "All mentors are signed in.", here "Nobody is signed in yet." When search is non-empty and a list is empty, that list simply shows nothing/'No match' — keep it quiet.
- CSS: change `.kiosk-body` to a 3-column grid (e.g. `grid-template-columns: 1.4fr 1fr 0.9fr`); add `.k-mentors` styles (mirror `.k-here` padding + a left border/divider); add `.k-search` input styling (dark, full-width, comfortable tap target); ensure the `@media (max-width: 720px)` block stacks all three columns and drops side borders.
- Verify: `docker exec team-hub-app-1 npx tsc --noEmit` clean; `docker exec team-hub-app-1 npx vitest run`; existing `e2e/kiosk.spec.ts` unaffected (API unchanged).

---

## Self-review checklist
- Role split matches People-page semantics (student vs non-student). ✓
- Colors defined once (module + CSS var), referenced by name everywhere. ✓
- Enter acts only on a unique match; sign-in vs sign-out chosen by which list the match is in. ✓
- Filter + focus reset after each action. ✓
- No API/schema changes; existing e2e stays green. ✓

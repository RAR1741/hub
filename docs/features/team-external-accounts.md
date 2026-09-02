# Team external accounts

Teams can have role-owned service accounts (e.g. `rarpo@redalert1741.org` for Drive, `@rar1741programmer` for
GitHub) linked to their Google Group or GitHub Team. These accounts belong to the role, not a person, and
are managed separately from the roster.

## Management

**Admin → Teams → [team name] → External accounts** shows all accounts for that team and allows add/remove.
The API is `POST/DELETE /api/admin/teams/[id]/external-accounts` — admin-only, matching the membership
endpoint. A **label** groups related accounts (e.g. "Programming bot") for display.

## Reconcile integration

Both [drive-group-sync](drive-group-sync.md) and [github-team-sync](github-team-sync.md) reconciles union
external accounts into the expected member list so they never appear in `wouldRemove`. Adding or removing
an account syncs to the linked Google Group or GitHub Team immediately (best-effort, logged on failure;
the nightly reconcile self-heals). These accounts never get hub access; a human holding the role gets
their own person row.

## GitHub identity exception

GitHub logins are normally verified via OAuth. External accounts are a deliberate exception: admins type
the login at save time and it's resolved to the stable numeric user id via the GitHub App. This is safe
because the account is team-owned and ownership verification adds nothing.

## Source

`src/lib/team-external-accounts.ts` (add/remove/list logic), `src/app/api/admin/teams/[id]/external-accounts/route.ts` (API), `src/components/ExternalAccountManager.tsx` (admin UI).

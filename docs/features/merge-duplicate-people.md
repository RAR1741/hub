# Finding and merging duplicate people

Team Hub's time-sheet CSV importer matches rows to a `person` by **name only**, and auto-creates a
new person on no match. A typo, a nickname, or a slightly different spelling ("Nat" vs. "Nathan",
"Sarah Lee" vs. "Sara Lee") is enough to create a second record for someone who already exists —
their history then gets split across two people. **Admin → People → Find duplicates** finds these
likely pairs and lets an admin merge them back into one person.

## How candidates are ranked

The finder scans all people and flags a pair as a likely duplicate when either is true:

- normalized Levenshtein similarity between the two full names is **≥ 0.72**, or
- the two share the same last name **and** one first name is a prefix of the other (e.g. "Nat" /
  "Nathan").

Matching pairs are sorted by score, highest first, and the page shows the **top 100**. Ranking is a
heuristic, not a verdict — the admin reviews each pair and decides.

## Using it

1. Go to **Admin → People → Find duplicates**.
2. Each candidate pair renders as two cards side-by-side — name, role, emails, session count, team
   list — so you can compare history at a glance.
3. Pick which side is canonical (the page defaults to the person with more sessions, then the one
   with a linked email/identity, then the lower id — but you can change it).
4. Click **Merge**. A confirm step spells out exactly what will happen before anything is written.
5. Confirm. The pair drops off the list once merged.

## What merge does

Merging is a single atomic database operation (`merge_person`). It reassigns every reference from
the loser to the winner — sessions (including event check-ins), team memberships, emails/identities,
excusals, applications, guardians, FIRST history, event sign-ups with their form responses and
reminder choices, badge awards, push subscriptions, the Onshape connection, and any staff/actor
references — then deletes the loser. It also carries over the loser's Slack and GitHub account links
and records the loser's name as a `person_name_alias` on the winner, so a future re-import of that
name resolves to the winner instead of recreating the duplicate.

Short-lived or pair-scoped rows are *not* carried over and disappear with the loser: pending login
codes, masquerade sessions, and "not a duplicate" pair rejections.

## Caveats

- **Irreversible.** There is no undo table. The confirm-with-preview step is the only safety gate —
  read it before confirming.
- **Email handling:** if the winner had no email of its own, it adopts the loser's email as its
  primary. Otherwise the winner's primary email is unchanged and the loser's emails become
  secondary identities on the winner.
- **Open sessions:** if both people have an open (unclosed) clock-in at merge time, the loser's open
  session is dropped — only the winner's stays open.
- **Duplicate collisions:** where both sides hold the same one-per-person row — a check-in to the
  same event, the same badge, a response to the same event's form, an Onshape connection, a linked
  Slack or GitHub account — the winner's is kept and the loser's is dropped. Re-link Slack/GitHub by
  hand afterwards if the wrong side was canonical.
- **Manager flag:** when both people are on the same team, the merged membership keeps
  `is_manager = true` if *either* side had it.
- **No dismiss action:** there's no "not a duplicate" control. A pair you judge to not be a
  duplicate will reappear on every visit to the page — acceptable at this roster's size, but worth
  knowing so it doesn't look like a bug.
- **Drive groups don't update immediately:** merging doesn't fire the real-time Drive-group sync
  hooks. If either person was on a team linked to a Google Group, the nightly reconcile job
  self-heals membership (see `docs/setup/google-drive-groups.md`) rather than updating it at merge
  time.

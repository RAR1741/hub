# Setting up prod database backups to Drive

Every night, prod gets a full logical dump, encrypted, and uploaded to Google Drive. The **code is
already wired** — you only add secrets to GitHub Actions and (once) verify a restore.

## What it does

A GitHub Actions workflow (`.github/workflows/db-backup.yml`) runs nightly at **07:00 UTC**:

1. `pg_dump`s the prod database (full logical dump),
2. gzips it,
3. encrypts it with `gpg` (symmetric, AES256),
4. uploads the result to a Google Drive folder via a service account
   (`scripts/backup-db-to-drive.ts`, also runnable locally as `npm run backup:db`),
5. keeps only the **newest 30** backups in the folder, deleting older ones.

## One-time setup (GitHub → Settings → Secrets and variables → Actions)

Add these repository secrets:

- **`BACKUP_DATABASE_URL`** — the prod **session pooler** connection string (Supabase → Project
  Settings → Database → Connection string → **Session pooler**), using the `postgres.<project-ref>`
  user. Be firm about which connection string this must be:
  - GitHub-hosted runners are **IPv4-only**.
  - Supabase's *direct* database hostname is **IPv6-only** on newer projects — unreachable from CI.
  - The *transaction* pooler is IPv4-reachable but lacks the session-level features `pg_dump`
    needs (it can't hold the transaction/session state a full dump requires).
  - The **session pooler** is the only option that's both IPv4-reachable and has the session
    features `pg_dump` needs. Using the wrong one fails the workflow at connect time or partway
    through the dump — don't substitute the direct or transaction-pooler URI here.

- **`GOOGLE_SA_CLIENT_EMAIL`** + **`GOOGLE_SA_PRIVATE_KEY`** — the existing service account (same
  one used for calendar/Drive-group sync; copy from Vercel env). Keep the private key in its
  `\n`-escaped single-line format.

- **`BACKUP_DRIVE_FOLDER_ID`** — the id of the target Drive folder. **Create the folder inside a
  Shared Drive** and add the service-account email as **Content Manager**. This matters: a service
  account has **no personal Drive storage quota**, so a plain My-Drive folder merely *shared* with
  the SA will fail uploads with `storageQuotaExceeded` — the SA has nowhere to charge the storage
  against. A folder that lives inside a Shared Drive is billed to the Shared Drive, not the SA, so
  uploads succeed.

- **`BACKUP_GPG_PASSPHRASE`** — store in the team password manager. This is symmetric encryption:
  the same passphrase decrypts every backup. **Losing it makes every backup permanently
  unreadable** — there is no recovery path.

- **`BACKUP_DRIVE_SUBJECT`** (optional) — only needed if your Workspace has **no Shared Drives**
  available and you must target a My Drive folder instead. Set this to a real user's email; the
  service account will impersonate that user via domain-wide delegation to get a personal quota to
  upload against. If you use this fallback, also add the
  `https://www.googleapis.com/auth/drive` scope to the SA's DWD grant in the Google admin console
  (**Security → API controls → Domain-wide delegation**) — the narrower scope used for Drive-group
  sync (`admin.directory.group.member`) doesn't cover Drive file uploads. Leave this secret unset
  entirely for the (recommended) Shared Drive path.

## Verify once

Trigger the workflow manually: **Actions → DB backup to Drive → Run workflow**. Confirm a file
named like `teamhub-backup-<stamp>.sql.gz.gpg` appears in the Drive folder afterward.

## Restore procedure

```bash
# decrypt + decompress + restore into a target database
gpg --batch --decrypt --pinentry-mode loopback --passphrase "$BACKUP_GPG_PASSPHRASE" \
    teamhub-backup-<stamp>.sql.gz.gpg \
  | gunzip \
  | psql "<target-connection-string>"
```

- **Restore into a SCRATCH database first — never straight into prod.**
- The dump is taken with `--no-owner --no-privileges`, so restored objects are created as
  whatever role owns the `psql` connection you restore with, not the original prod roles.
- Restoring the **full** dump into a plain (non-Supabase) Postgres instance will emit warnings/
  errors for managed schemas and roles that don't exist there (Supabase-specific schemas, the
  `supabase_admin` role, etc.). Two ways to avoid the noise:
  - restore only the `public` schema (and `auth` too, if you need user records) selectively, or
  - restore into a fresh Supabase-flavored scratch database, where those schemas/roles already
    exist.

  Either way, `public` is what actually matters for this app's data.

### This is a maintainer operator step

**Running the restore once, for real, to prove a backup is actually restorable, is a one-time step
the maintainer must do by hand.** CI can trigger the backup workflow, but it has no way to prove a
restore succeeds without real scratch-database credentials — there's no way to verify this
autonomously. Do it once after setup, then periodically if you want ongoing confidence.

## Caveats

- **The GPG passphrase is the single point of failure.** It lives only in the password manager and
  the `BACKUP_GPG_PASSPHRASE` secret — if both are lost, every backup ever taken becomes
  permanently unreadable. Treat it like a root credential.
- **This is a logical dump, not point-in-time recovery.** It's portable and independent of the
  Supabase project, but it is **not a substitute for Supabase PITR** (available on paid tiers) if
  you need sub-day recovery point objectives. This backup gives you one restore point per night;
  PITR gives you continuous coverage.

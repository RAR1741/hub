# Automatic Prod-DB Backup to Google Drive Implementation Plan (issue #37)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled, unattended nightly job that takes a full logical `pg_dump` of the production database, encrypts it, uploads it to a dedicated Google Drive folder via a service account, and prunes to the last 30 — with a documented, restorable path.

**Architecture:** A GitHub Actions cron workflow (issue option 1) runs `pg_dump` against prod, gzips, and symmetrically encrypts with `gpg` (member PII). A small TypeScript CLI (`scripts/backup-db-to-drive.ts`, run via `tsx`) uploads the encrypted dump to Drive and prunes old backups, reusing the already-tested service-account token minting in `src/lib/google-auth.ts`. The risky pure logic (retention selection, Drive request construction) lives in tested `src/lib/` modules.

**Tech Stack:** GitHub Actions, `pg_dump` (PostgreSQL client **17** — prod is PG 17.6), gzip, gpg, Node 22, `tsx`, Google Drive API v3, vitest.

## Decisions (issue #37 approach options — resolved)

- **Option 1 (GitHub Actions cron).** Simplest to reason about; the runner reaches Supabase over the public pooler; secrets live in Actions secrets. Not the in-platform Edge/Vercel options (function time/size limits constrain a full dump).
- **Service account:** reuse the existing one (`GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY`, already provisioned for #32/#30) with the **Drive** scope. Add these as **GitHub Actions repo secrets** (they currently live only in Vercel env).
- **Where the backups land — IMPORTANT (avoids a first-run `storageQuotaExceeded`):** a service account has *no* personal Drive storage quota, so files it uploads to an ordinary "My Drive" folder shared with it will fail. Two supported targets, documented and code-supported:
  1. **Preferred — a Shared Drive folder** with the SA added as Content Manager. The client already sends `supportsAllDrives=true` on every call, so this needs NO code change, only the doc instruction to use a Shared Drive.
  2. **Fallback — domain-wide-delegation impersonation** (this Workspace already has DWD for the Directory API). An OPTIONAL `BACKUP_DRIVE_SUBJECT` env: when set, it's passed as the `subject` to `fetchGoogleAccessToken` so uploaded files are owned by (and count against) that real user's Drive. Requires adding the `https://www.googleapis.com/auth/drive` scope to the DWD grant in the admin console.
  The doc leads with the Shared Drive requirement and documents the optional subject for Workspace editions without Shared Drives.
- **Encryption:** `gpg` symmetric (AES256) with a passphrase secret, applied before upload. The dump contains PII (names, emails, student IDs).
- **Retention:** keep the newest 30 backups in the folder; prune the rest each run.
- **Upload:** Drive `multipart` upload (one request). Fine at the current DB size (a few MB gzipped+encrypted); if dumps grow past a few tens of MB, switch to resumable — noted in the doc, not built now.
- **Restore "tested once":** documented in full; the one-time real restore verification is a **user operational step** (the sandbox/CI has no prod credentials or Drive access to exercise it safely). Mirrors the #46 prod-enable pattern.
- **PITR note:** Supabase offers point-in-time recovery on paid tiers; this logical-dump backup is the independent, portable copy the issue asks for and does not replace PITR. Stated in the doc.

## Global Constraints

- Tests: `docker exec team-hub-app-1 npx vitest run`. Typecheck: `docker exec team-hub-app-1 npx tsc --noEmit 2>&1 | grep -v ".next/dev/types"`.
- Commit directly to `master`; `git push origin master` after EVERY commit. Co-author trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No DB migration in this feature (backup only reads).
- Never commit secrets. The workflow reads everything from `secrets.*`; the docs list what to configure.
- Pure logic is unit-tested in `src/lib/`; I/O modules are tested with an injected fake `fetch` (mirror the `src/lib/google-directory.test.ts` idiom). The end-to-end backup + restore run needs real prod/Drive credentials and is a documented user step.

**pg_dump preflight (already verified against the local PG 17.6 Supabase DB — do NOT re-decide):** a full-database `pg_dump ... --no-owner --no-privileges` connecting as the `postgres` role SUCCEEDS with exit 0 and zero errors, including all managed schemas (auth, storage, realtime, extensions, graphql, pgbouncer, vault, supabase_functions, supabase_migrations); `--schema=public` also works. So NO schema-exclusion flags are needed in the workflow — the full dump is correct as written. The only requirement is that the connection role has read access (the `postgres`/pooler role does). The container's own bundled pg_dump is 15.x — irrelevant, the CI runner installs client 17 (Task 4).

---

### Task 1: Backup retention + naming (pure)

**Files:**
- Create: `src/lib/backup-retention.ts`
- Create: `src/lib/backup-retention.test.ts`

**Interfaces:**
- Produces:
  - `type DriveFileMeta = { id: string; name: string; createdTime: string }`
  - `backupObjectName(iso: string): string` — `` `teamhub-backup-${iso}.sql.gz.gpg` `` (caller passes a filesystem-safe ISO like `2026-08-16T07-00-00Z`)
  - `selectBackupsToDelete(files: DriveFileMeta[], keep: number): string[]` — sort by `createdTime` desc (tiebreak `name` desc for determinism), keep the newest `keep`, return the ids of the rest. `keep <= 0` returns all ids; fewer than `keep` files returns `[]`. PURE.

- [ ] **Step 1: Write failing tests** covering: name format; keeping newest N by createdTime; returning the older ids; `keep` larger than list → `[]`; `keep = 0` → all ids; deterministic tiebreak on equal createdTime. Run → FAIL.

- [ ] **Step 2: Implement** `src/lib/backup-retention.ts`:

```ts
export type DriveFileMeta = { id: string; name: string; createdTime: string };

/** Filesystem/Drive-safe backup object name for a given ISO stamp. PURE. */
export function backupObjectName(iso: string): string {
  return `teamhub-backup-${iso}.sql.gz.gpg`;
}

/**
 * Given the backup files currently in the folder, return the ids to delete so
 * only the newest `keep` remain. Sorts by createdTime desc (name desc as a
 * stable tiebreak). PURE.
 */
export function selectBackupsToDelete(files: DriveFileMeta[], keep: number): string[] {
  const sorted = [...files].sort((a, b) => {
    if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  });
  if (keep <= 0) return sorted.map((f) => f.id);
  return sorted.slice(keep).map((f) => f.id);
}
```

- [ ] **Step 3: Tests PASS**, full suite + tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/backup-retention.ts src/lib/backup-retention.test.ts
git commit -m "feat(backup): pure retention selection + backup naming"
git push origin master
```

---

### Task 2: Drive backup client (upload / list / prune)

**Files:**
- Create: `src/lib/drive-backup.ts`
- Create: `src/lib/drive-backup.test.ts`

**Interfaces:**
- Consumes: `fetchGoogleAccessToken` (`src/lib/google-auth.ts`), Task 1 helpers.
- Produces:
  - `type DriveBackupCredentials = { clientEmail: string; privateKey: string; subject?: string }` — `subject` is the optional DWD impersonation user (see decisions #1 fallback).
  - `type DriveBackupDeps = { fetch: typeof globalThis.fetch; credentials: DriveBackupCredentials; now?: () => number }`
  - `const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"`
  - `driveBackupCredentialsFromEnv(): DriveBackupCredentials | null` — reads `GOOGLE_SA_CLIENT_EMAIL` + `GOOGLE_SA_PRIVATE_KEY` (restore `\n`), null if either missing; includes `subject` ONLY when `process.env.BACKUP_DRIVE_SUBJECT` is a non-empty string (an unset GitHub secret resolves to `""`, which must be treated as absent — `subject` stays undefined so an SA-owned token is minted for the Shared-Drive path).
  - `uploadBackup(deps, opts: { folderId: string; name: string; data: Uint8Array }): Promise<{ id: string }>` — Drive v3 multipart upload; throws on non-2xx.
  - `listBackups(deps, folderId: string, prefix: string): Promise<DriveFileMeta[]>` — list non-trashed files in the folder whose name starts with `prefix`; returns `{id,name,createdTime}` (fields query).
  - `deleteDriveFile(deps, id: string): Promise<void>` — throws on non-2xx (404 tolerated).
  - `pruneBackups(deps, folderId, prefix, keep): Promise<string[]>` — `listBackups` → `selectBackupsToDelete` → delete each; returns the deleted ids.

- [ ] **Step 1: Write failing tests** (`drive-backup.test.ts`) with an injected fake `fetch` (mirror `google-directory.test.ts`), a stub token endpoint, and assertions:
  - `uploadBackup` POSTs to `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true` with `Authorization: Bearer <token>`, a `multipart/related; boundary=…` content-type, and a body containing the JSON metadata part (`name`, `parents:[folderId]`) and the octet-stream data part; returns the new id from the response.
  - `listBackups` GETs `files` with a `q` filtering `'<folderId>' in parents and name contains '<prefix>' and trashed = false`, requests `fields=files(id,name,createdTime)`, and maps the response.
  - `deleteDriveFile` issues DELETE to `.../files/<id>?supportsAllDrives=true`; treats 404 as ok, throws on other non-2xx.
  - `pruneBackups` deletes exactly the ids `selectBackupsToDelete` chooses (stub a list of 32 → deletes 2 with keep=30).
  Run → FAIL.

- [ ] **Step 2: Implement** `src/lib/drive-backup.ts` — mirror the token-cache + deps idiom of `google-directory.ts` (a `WeakMap<DriveBackupDeps, Promise<string>>` token cache; `fetchGoogleAccessToken(deps.fetch, deps.credentials, { scope: DRIVE_SCOPE, ...(deps.credentials.subject ? { subject: deps.credentials.subject } : {}) }, deps.now)` — pass `subject` ONLY when present, so a plain Shared-Drive setup mints an SA-owned token and a DWD setup impersonates the user). Add one test that a `subject` in creds is forwarded to the token exchange (assert the JWT claim path or that the token fetch is invoked with the subject — mirror how `google-auth.test.ts`/`google-directory.test.ts` assert this). Build the multipart body from a JSON part + the `data` bytes with a fixed boundary via `Blob`/`Uint8Array` concatenation (Node 22 has `Blob`/`fetch`). Example upload core:

```ts
const boundary = "teamhub-backup-boundary";
const meta = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
const enc = new TextEncoder();
const pre = enc.encode(
  `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
  `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
);
const post = enc.encode(`\r\n--${boundary}--`);
const body = new Uint8Array(pre.length + opts.data.length + post.length);
body.set(pre, 0);
body.set(opts.data, pre.length);
body.set(post, pre.length + opts.data.length);
const res = await deps.fetch(
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  },
);
if (!res.ok) throw new Error(`drive upload failed: ${res.status}`);
const json = (await res.json()) as { id?: string };
if (!json.id) throw new Error("drive upload returned no id");
return { id: json.id };
```

`listBackups` builds a `URL` with `q`, `fields=files(id,name,createdTime)`, `orderBy=createdTime desc`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, `pageSize=1000`; `deleteDriveFile` DELETEs with `supportsAllDrives=true`.

- [ ] **Step 3: Tests PASS**, full suite + tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/drive-backup.ts src/lib/drive-backup.test.ts
git commit -m "feat(backup): Drive upload/list/prune client (service-account, drive scope)"
git push origin master
```

---

### Task 3: Backup CLI entry + `tsx` runner

**Files:**
- Create: `scripts/backup-db-to-drive.ts`
- Modify: `package.json` (add `tsx` devDependency + a `backup:db` script)

**Interfaces:**
- Consumes: `drive-backup.ts`, `backup-retention.ts`.

- [ ] **Step 1: Add `tsx`.** `docker exec team-hub-app-1 npm install --save-dev tsx` (pins it in package.json + lockfile). Add a script: `"backup:db": "tsx scripts/backup-db-to-drive.ts"`.

- [ ] **Step 2: Implement `scripts/backup-db-to-drive.ts`.** It receives the path to the already-encrypted dump file as `process.argv[2]` (the workflow produces it), reads env, uploads, then prunes. Use RELATIVE imports (not the `@/` alias) so `tsx` resolves cleanly from `scripts/`:

```ts
import { readFile } from "node:fs/promises";
import { driveBackupCredentialsFromEnv, uploadBackup, pruneBackups } from "../src/lib/drive-backup";
import { backupObjectName } from "../src/lib/backup-retention";

async function main() {
  const filePath = process.argv[2];
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  const iso = process.env.BACKUP_STAMP; // filesystem-safe ISO from the workflow
  const keep = Number(process.env.BACKUP_KEEP ?? "30");
  const credentials = driveBackupCredentialsFromEnv();
  if (!filePath) throw new Error("usage: backup-db-to-drive <encrypted-dump-path>");
  if (!folderId) throw new Error("BACKUP_DRIVE_FOLDER_ID is required");
  if (!iso) throw new Error("BACKUP_STAMP is required");
  if (!credentials) throw new Error("GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY are required");

  const data = new Uint8Array(await readFile(filePath));
  const deps = { fetch: globalThis.fetch, credentials };
  const name = backupObjectName(iso);
  const { id } = await uploadBackup(deps, { folderId, name, data });
  console.log(`uploaded ${name} (${data.length} bytes) as ${id}`);
  const deleted = await pruneBackups(deps, folderId, "teamhub-backup-", keep);
  console.log(`pruned ${deleted.length} old backup(s), keeping ${keep}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 3: Verify** `docker exec team-hub-app-1 npx tsc --noEmit 2>&1 | grep -v ".next/dev/types"` clean; full suite green (the new devDep/script don't affect tests). A no-arg run should exit non-zero with the usage error — optionally verify: `docker exec team-hub-app-1 node -e "process.exit(0)"` is not needed; do NOT attempt a real upload (no creds).

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-db-to-drive.ts package.json package-lock.json
git commit -m "feat(backup): backup-db-to-drive CLI (tsx runner)"
git push origin master
```

---

### Task 4: Nightly GitHub Actions workflow

**Files:**
- Create: `.github/workflows/db-backup.yml`

- [ ] **Step 1: Write the workflow.** Nightly cron + manual `workflow_dispatch`. Installs PostgreSQL **17** client from the PGDG apt repo (ubuntu-latest ships an older client and `pg_dump` refuses a newer server), dumps, gzips, gpg-encrypts, then runs the CLI.

```yaml
name: DB backup to Drive
on:
  schedule:
    - cron: "0 7 * * *" # 07:00 UTC nightly (~2-3am US Central)
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Install PostgreSQL 17 client
        run: |
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17
      - name: Dump, gzip, encrypt
        env:
          BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
          BACKUP_GPG_PASSPHRASE: ${{ secrets.BACKUP_GPG_PASSPHRASE }}
        run: |
          set -euo pipefail
          STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
          echo "BACKUP_STAMP=$STAMP" >> "$GITHUB_ENV"
          FILE="teamhub-backup-$STAMP.sql.gz.gpg"
          echo "BACKUP_FILE=$FILE" >> "$GITHUB_ENV"
          pg_dump "$BACKUP_DATABASE_URL" --no-owner --no-privileges \
            | gzip -9 \
            | gpg --batch --yes --symmetric --cipher-algo AES256 \
                  --pinentry-mode loopback --passphrase "$BACKUP_GPG_PASSPHRASE" -o "$FILE"
          ls -la "$FILE"
      - name: Upload to Drive + prune
        env:
          GOOGLE_SA_CLIENT_EMAIL: ${{ secrets.GOOGLE_SA_CLIENT_EMAIL }}
          GOOGLE_SA_PRIVATE_KEY: ${{ secrets.GOOGLE_SA_PRIVATE_KEY }}
          BACKUP_DRIVE_FOLDER_ID: ${{ secrets.BACKUP_DRIVE_FOLDER_ID }}
          # Optional: only needed for the DWD-impersonation fallback (My-Drive
          # target). Unset when uploading to a Shared Drive. secrets.* that are
          # unset resolve to an empty string, which the CLI treats as absent.
          BACKUP_DRIVE_SUBJECT: ${{ secrets.BACKUP_DRIVE_SUBJECT }}
          BACKUP_KEEP: "30"
        run: npm run backup:db -- "$BACKUP_FILE"
```

Notes for the implementer: `BACKUP_STAMP` is exported to `$GITHUB_ENV` in the dump step so the CLI's `backupObjectName` matches the actual filename. `--no-owner --no-privileges` keeps the dump portable across roles. Do NOT echo secrets. Keep `set -euo pipefail` so a `pg_dump` failure fails the job (pipefail is essential — without it a `pg_dump` error is masked by a successful `gpg`).

- [ ] **Step 2: Validate YAML** (parse locally, e.g. `docker exec team-hub-app-1 node -e "require('js-yaml')"` is not available — instead just eyeball structure, or use `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/db-backup.yml'))"` if python is present). Do not trigger the workflow (needs secrets). Confirm the file is well-formed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/db-backup.yml
git commit -m "feat(backup): nightly GitHub Actions workflow (pg_dump -> gzip -> gpg -> Drive)"
git push origin master
```

---

### Task 5: Setup + restore docs

**Files:**
- Create: `docs/setup/db-backup.md`

- [ ] **Step 1: Write the doc.** Cover:
  - **What it does / schedule:** nightly (07:00 UTC) full logical dump, gzipped, AES256-encrypted, uploaded to a Drive folder; keeps the newest 30.
  - **One-time setup (GitHub → Settings → Secrets and variables → Actions):**
    - `BACKUP_DATABASE_URL` — the prod **session pooler** connection string. Be firm here: GitHub-hosted runners are IPv4-only and Supabase *direct* DB hostnames are IPv6-only on newer projects (unreachable from CI), while the *transaction* pooler lacks the session features `pg_dump` needs. Use the **session pooler** URI (Supabase → Project Settings → Database → Connection string → Session pooler), which uses a `postgres.<project-ref>` user with read access to everything the dump needs.
    - `GOOGLE_SA_CLIENT_EMAIL` + `GOOGLE_SA_PRIVATE_KEY` — the existing service account (copy from Vercel env; keep the `\n`-escaped key format).
    - `BACKUP_DRIVE_FOLDER_ID` — the id of the target folder. **Create it inside a Shared Drive** and add the service-account email as **Content Manager**. (A plain My-Drive folder shared with the SA will fail with `storageQuotaExceeded` — a service account has no personal Drive quota.)
    - `BACKUP_GPG_PASSPHRASE` — store in the team password manager. Without it every backup is permanently unreadable.
    - `BACKUP_DRIVE_SUBJECT` (OPTIONAL) — only if your Workspace has no Shared Drives and you must target My Drive: set this to a real user's email to impersonate via domain-wide delegation, and add the `https://www.googleapis.com/auth/drive` scope to the SA's DWD grant in the Google admin console (Security → API controls → Domain-wide delegation). Leave unset for the Shared Drive path.
  - **Verify once:** trigger the workflow via **Actions → DB backup to Drive → Run workflow**; confirm a `teamhub-backup-<stamp>.sql.gz.gpg` appears in the Drive folder.
  - **Restore procedure (RUN IT ONCE to verify):**
    ```bash
    # decrypt + decompress into a target database
    gpg --batch --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" teamhub-backup-<stamp>.sql.gz.gpg \
      | gunzip \
      | psql "<target-connection-string>"
    ```
    Restore into a SCRATCH database first (never straight into prod). Note that `--no-owner --no-privileges` means objects are created as the connecting role.
  - **Caveats:** the passphrase is the single point of failure — losing it makes every backup unreadable. This logical dump is independent/portable but is NOT a substitute for Supabase PITR (paid tiers) if sub-day RPO is needed.
  - Flag clearly that the **one-time restore verification is an operator step** the maintainer must run (CI has no way to prove a restore works without real credentials).

- [ ] **Step 2: Commit**

```bash
git add docs/setup/db-backup.md
git commit -m "docs(backup): DB-backup setup + restore procedure"
git push origin master
```

---

## Operator steps required after implementation (surface in the final summary)

1. Add the GitHub Actions secrets (`BACKUP_DATABASE_URL` = session pooler URI, `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `BACKUP_DRIVE_FOLDER_ID`, `BACKUP_GPG_PASSPHRASE`; optionally `BACKUP_DRIVE_SUBJECT`).
2. Create the target folder **inside a Shared Drive** and add the service-account email as Content Manager; put its folder id in `BACKUP_DRIVE_FOLDER_ID`. (Only if no Shared Drive is available: use a My-Drive folder plus `BACKUP_DRIVE_SUBJECT` + the `drive` DWD scope.)
3. Run the workflow once via `workflow_dispatch` and confirm the file lands in Drive.
4. Run the restore procedure once into a scratch database to prove the backup is restorable (the issue's "verify it once"). Restoring the full dump into a plain Postgres will emit warnings for managed-schema objects/roles that don't exist there — restore `public` (and `auth` if you need users) selectively, or restore into a fresh Supabase-flavored DB; the `public`-schema data is what matters for this app.
